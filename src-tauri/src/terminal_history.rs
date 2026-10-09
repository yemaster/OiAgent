//! Mirror native JSONL records into the owning conversation, never terminal escape sequences.
use crate::{history, models::*, store::AppState, transcript};
use std::{
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
};

fn native_path(state: &AppState, task: &Task) -> Option<String> {
    let sid = task.session_id.as_deref()?;
    let mut history = state.history.lock().unwrap();
    history.cached();
    let cached = history.find_session(&task.agent_kind, sid);
    if let Some(path) = cached
        .and_then(|t| t.history_path)
        .filter(|p| std::path::Path::new(p).is_file())
    {
        return Some(path);
    }
    history.scan();
    history
        .find_session(&task.agent_kind, sid)
        .and_then(|t| t.history_path)
}

fn log_path(state: &AppState, id: &str) -> std::path::PathBuf {
    state.dir.join("logs").join(format!("{id}.messages.jsonl"))
}

/// Capture only complete records, leaving a partially written final line for the next read.
fn complete_len(file: &mut File) -> Result<u64, String> {
    let mut end = file.metadata().map_err(|e| e.to_string())?.len();
    let mut buffer = [0; 4096];
    while end > 0 {
        let start = end.saturating_sub(buffer.len() as u64);
        file.seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        let count = (end - start) as usize;
        file.read_exact(&mut buffer[..count])
            .map_err(|e| e.to_string())?;
        if let Some(index) = buffer[..count].iter().rposition(|b| *b == b'\n') {
            return Ok(start + index as u64 + 1);
        }
        end = start;
    }
    Ok(0)
}

pub fn prepare(state: &AppState, owner: &Task) -> Result<TerminalCursor, String> {
    let path = native_path(state, owner);
    let mut cursor = TerminalCursor {
        finished: false,
        path: path.clone(),
        offset: 0,
        after: Some(now()),
    };
    if let Some(path) = path {
        let mut file = File::open(&path).map_err(|e| e.to_string())?;
        cursor.offset = complete_len(&mut file)?;
        cursor.after = None;
        // Imported conversations do not yet have a managed transcript.
        if !log_path(state, &owner.id).exists() {
            file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            let mut messages = Vec::new();
            for line in BufReader::new(file.take(cursor.offset)).lines() {
                let line = line.map_err(|e| e.to_string())?;
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) {
                    if value["isSidechain"] == true {
                        continue;
                    }
                    let timestamp = history::string(&value, "timestamp");
                    messages.extend(transcript::messages(&value, &timestamp).into_iter().map(
                        |mut message| {
                            message.agent_kind = Some(owner.agent_kind.clone());
                            message
                        },
                    ));
                }
            }
            append(state, &owner.id, &messages)?;
        }
    }
    Ok(cursor)
}

fn append(state: &AppState, owner: &str, messages: &[Message]) -> Result<(), String> {
    if messages.is_empty() {
        return Ok(());
    }
    let mut data = Vec::new();
    for message in messages {
        serde_json::to_writer(&mut data, message).map_err(|e| e.to_string())?;
        data.push(b'\n');
    }
    let mut file = OpenOptions::new()
        .append(true)
        .create(true)
        .open(log_path(state, owner))
        .map_err(|e| e.to_string())?;
    let original_len = file.metadata().map_err(|e| e.to_string())?.len();
    if let Err(error) = file.write_all(&data).and_then(|_| file.flush()) {
        let _ = file.set_len(original_len);
        return Err(error.to_string());
    }
    Ok(())
}

pub fn sync_owner(state: &AppState, id: &str) -> Result<Option<Task>, String> {
    sync(state, id, false, None)
}
pub fn finish_owner(state: &AppState, id: &str, terminal_id: &str) -> Result<Option<Task>, String> {
    sync(state, id, true, Some(terminal_id))
}
fn sync(
    state: &AppState,
    id: &str,
    finish: bool,
    expected_terminal: Option<&str>,
) -> Result<Option<Task>, String> {
    let _guard = state.terminal_sync.lock().map_err(|e| e.to_string())?;
    let (owner, terminal) = {
        let db = state.db.lock().unwrap();
        let Some(owner) = db.tasks.iter().find(|t| t.id == id) else {
            return Ok(None);
        };
        let Some(terminal) = owner
            .terminal_id
            .as_ref()
            .and_then(|id| db.tasks.iter().find(|t| &t.id == id))
        else {
            return Ok(None);
        };
        (owner.clone(), terminal.clone())
    };
    if expected_terminal.is_some_and(|id| id != terminal.id) {
        return Ok(None);
    }
    if !["codex", "claude", "qwen"].contains(&terminal.agent_kind.as_str())
        || terminal.session_id.is_none()
    {
        return Ok(None);
    }
    let finish = finish
        || (terminal.status != "running" && !state.ptys.lock().unwrap().contains_key(&terminal.id));
    let mut cursor = terminal.terminal_cursor.clone().unwrap_or(TerminalCursor {
        finished: false,
        path: None,
        offset: 0,
        after: Some(terminal.created_at.clone()),
    });
    if cursor.finished {
        return Ok(None);
    }
    if cursor
        .path
        .as_ref()
        .is_none_or(|p| !std::path::Path::new(p).is_file())
    {
        cursor.path = native_path(state, &terminal);
    }
    let Some(path) = &cursor.path else {
        if finish {
            cursor.finished = true;
            let mut db = state.db.lock().unwrap();
            if let Some(task) = db.tasks.iter_mut().find(|t| t.id == terminal.id) {
                task.terminal_cursor = Some(cursor);
            }
            state.save(&db)?;
        }
        return Ok(None);
    }; // CLI may not have created its transcript yet.
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() < cursor.offset {
        return Err("原生会话记录已截断，已暂停同步以避免重复消息".into());
    }
    file.seek(SeekFrom::Start(cursor.offset))
        .map_err(|e| e.to_string())?;
    let previous_offset = cursor.offset;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut messages = Vec::new();
    loop {
        line.clear();
        let count = reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if count == 0 || (!line.ends_with('\n') && !finish) {
            break;
        }
        cursor.offset += count as u64;
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        if value["isSidechain"] == true {
            continue;
        }
        let timestamp = history::string(&value, "timestamp");
        if let Some(after) = &cursor.after {
            let is_recent = chrono::DateTime::parse_from_rfc3339(&timestamp)
                .ok()
                .zip(chrono::DateTime::parse_from_rfc3339(after).ok())
                .is_some_and(|(time, start)| time >= start);
            if !is_recent {
                continue;
            }
        }
        messages.extend(
            transcript::messages(&value, &timestamp)
                .into_iter()
                .map(|mut message| {
                    message.agent_kind = Some(terminal.agent_kind.clone());
                    message
                }),
        );
    }
    if !finish && cursor.offset == previous_offset && terminal.terminal_cursor.is_some() {
        return Ok(None);
    }
    cursor.finished = finish;
    append(state, &owner.id, &messages)?;
    let mut db = state.db.lock().unwrap();
    if let Some(task) = db.tasks.iter_mut().find(|t| t.id == terminal.id) {
        task.terminal_cursor = Some(cursor);
    }
    let updated =
        if !messages.is_empty() {
            db.tasks.iter_mut().find(|t| t.id == owner.id).map(|task| {
                if let Some(message) = messages.iter().rev().find(|m| {
                    ["assistant", "user"].contains(&m.role.as_str()) && !m.text.is_empty()
                }) {
                    task.preview = history::short(&message.text, 240);
                }
                task.updated_at = now();
                task.clone()
            })
        } else {
            None
        };
    state.save(&db)?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task(id: &str) -> Task {
        serde_json::from_value(serde_json::json!({
            "id":id, "title":id, "prompt":"hello", "project":"/tmp", "agentId":"claude", "agentKind":"claude",
            "status":"completed", "createdAt":"2026-10-09T00:00:00Z", "updatedAt":"", "preview":"", "usage":{"input":0,"output":0,"cached":0,"known":false}, "sessionId":"session", "source":"managed", "model":"", "permission":"auto", "exitCode":null
        })).unwrap()
    }
    fn event(text: &str) -> String {
        serde_json::json!({"type":"assistant", "timestamp":"2026-10-09T01:00:00Z", "sessionId":"session", "cwd":"/tmp", "message":{"content":[{"type":"text", "text":text}]}}).to_string()
    }
    fn records(state: &AppState) -> Vec<Message> {
        BufReader::new(File::open(log_path(state, "owner")).unwrap())
            .lines()
            .map(|line| serde_json::from_str(&line.unwrap()).unwrap())
            .collect()
    }
    #[test]
    fn terminal_records_sync_once_preserve_other_agents_and_resume_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let native = dir.path().join("native.jsonl");
        let baseline = format!("{}\n", event("before terminal"));
        std::fs::write(&native, &baseline).unwrap();
        let state = AppState::load(dir.path().join("app")).unwrap();
        let mut owner = task("owner");
        owner.terminal_id = Some("terminal".into());
        owner.sessions.push(AgentSession {
            agent_id: "codex".into(),
            agent_kind: "codex".into(),
            provider_id: None,
            session_id: "other".into(),
        });
        let mut terminal = task("terminal");
        terminal.source = "terminal".into();
        terminal.status = "running".into();
        terminal.parent_id = Some("owner".into());
        terminal.terminal_cursor = Some(TerminalCursor {
            finished: false,
            path: Some(native.to_string_lossy().into()),
            offset: baseline.len() as u64,
            after: None,
        });
        state.db.lock().unwrap().tasks.extend([owner, terminal]);
        append(
            &state,
            "owner",
            &[Message {
                agent_kind: Some("codex".into()),
                role: "assistant".into(),
                text: "codex history".into(),
                timestamp: now(),
                tool: None,
                parent_call_id: None,
                delta: false,
            }],
        )
        .unwrap();
        assert!(finish_owner(&state, "owner", "unrelated-terminal")
            .unwrap()
            .is_none());
        let mut file = OpenOptions::new().append(true).open(&native).unwrap();
        writeln!(file, "{}", event("from TUI")).unwrap();
        write!(file, "{}", event("partial record")).unwrap();
        assert!(sync_owner(&state, "owner").unwrap().is_some());
        assert_eq!(
            records(&state)
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            ["codex history", "from TUI"]
        );
        assert!(sync_owner(&state, "owner").unwrap().is_none());
        let state = AppState::load(state.dir.clone()).unwrap();
        // Simulate reconnecting the view while the same native writer continues.
        state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter_mut()
            .find(|t| t.id == "terminal")
            .unwrap()
            .status = "running".into();
        writeln!(file).unwrap();
        let tool = serde_json::json!({"type":"assistant","timestamp":now(),"message":{"content":[{"type":"tool_use","id":"call","name":"Bash","input":{"command":"pwd"}}]}});
        writeln!(file, "{tool}").unwrap();
        sync_owner(&state, "owner").unwrap();
        let messages = records(&state);
        assert_eq!(messages.len(), 4);
        assert_eq!(messages[0].agent_kind.as_deref(), Some("codex"));
        assert_eq!(messages[2].text, "partial record");
        assert!(messages[3].tool.is_some());
        finish_owner(&state, "owner", "terminal").unwrap();
        writeln!(file, "{}", event("later GUI run")).unwrap();
        sync_owner(&state, "owner").unwrap();
        assert_eq!(records(&state).len(), 4); // finished PTYs never mirror subsequent headless runs
    }
    #[test]
    fn incomplete_final_line_is_not_part_of_the_baseline() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("history.jsonl");
        std::fs::write(&path, "first\npartial").unwrap();
        assert_eq!(complete_len(&mut File::open(path).unwrap()).unwrap(), 6);
    }
}
