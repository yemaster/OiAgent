//! Never rewrite a native rollout or invent a successful tool result. An
//! interrupted tool call can make Codex's resume normalization fail repeatedly;
//! recover through the same bounded context handoff used when switching agents.
use crate::{models::Task, store::AppState};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs::File,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

fn observe(item: &Value, pending: &mut HashSet<(String, String)>) {
    let Some(id) = item["call_id"].as_str() else {
        return;
    };
    match item["type"].as_str().unwrap_or_default() {
        kind @ ("function_call" | "custom_tool_call") => {
            pending.insert((kind.into(), id.into()));
        }
        "function_call_output" => {
            pending.remove(&("function_call".into(), id.into()));
        }
        "custom_tool_call_output" => {
            pending.remove(&("custom_tool_call".into(), id.into()));
        }
        _ => {}
    }
}

fn missing(path: &Path, session: &str) -> Option<usize> {
    let file = File::open(path).ok()?;
    let mut pending = HashSet::new();
    let mut matches = false;
    for line in BufReader::new(file).lines() {
        // An unreadable/partially written rollout is not evidence of a missing output.
        // Once its identity is known, stop lookup as well: an older rotation
        // must not override the state of this newer, incomplete file.
        let row: Value = match line.ok().and_then(|line| serde_json::from_str(&line).ok()) {
            Some(row) => row,
            None => return matches.then_some(0),
        };
        match row["type"].as_str().unwrap_or_default() {
            "session_meta" => {
                if row["payload"]["id"].as_str() != Some(session) {
                    return None;
                }
                matches = true;
            }
            "response_item" => observe(&row["payload"], &mut pending),
            "compacted" => {
                // Only the effective replacement history will be sent on resume.
                pending.clear();
                if let Some(items) = row["payload"]["replacement_history"].as_array() {
                    for item in items {
                        observe(item, &mut pending);
                    }
                }
            }
            _ => {}
        }
    }
    matches.then_some(pending.len())
}

fn candidates(task: &Task, env: &BTreeMap<String, String>) -> Vec<PathBuf> {
    let Some(session) = &task.session_id else {
        return vec![];
    };
    let root = env
        .get("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("CODEX_HOME").map(PathBuf::from))
        .or_else(|| dirs::home_dir().map(|p| p.join(".codex")));
    let mut paths = Vec::new();
    let suffix = format!("{session}.jsonl");
    if let Some(root) = root {
        for folder in ["sessions", "archived_sessions"] {
            paths.extend(
                walkdir::WalkDir::new(root.join(folder))
                    .into_iter()
                    .filter_map(Result::ok)
                    .filter(|e| {
                        e.file_type().is_file()
                            && e.file_name().to_str().is_some_and(|n| n.ends_with(&suffix))
                    })
                    .map(|e| e.into_path()),
            );
        }
    }
    // Imported paths also support custom layouts. A header check prevents using
    // a previous session's history after a successful recovery.
    if let Some(path) = &task.history_path {
        paths.push(PathBuf::from(path));
    }
    paths.sort();
    paths.dedup();
    paths.sort_by_key(|p| std::cmp::Reverse(p.metadata().and_then(|m| m.modified()).ok()));
    paths
}

pub fn prepare(
    state: &AppState,
    task: &Task,
    env: &BTreeMap<String, String>,
    invocation: &mut Task,
) -> Result<Option<String>, String> {
    let Some(session) = invocation.session_id.clone() else {
        return Ok(None);
    };
    let count = candidates(task, env)
        .iter()
        .find_map(|path| missing(path, &session))
        .unwrap_or(0);
    if count == 0 {
        return Ok(None);
    }
    if crate::commands::slash(&invocation.prompt).is_some() {
        return Err("Codex 原生会话有工具调用缺少结果，请发送普通消息以携带上下文恢复会话".into());
    }
    let prompt = crate::followup::context(state, task, &invocation.prompt);
    invocation.prompt = format!("恢复提示：上一段 Codex 原生会话有 {count} 个工具调用未记录结果。其执行结果未知，不能视为成功，也不要直接重放。继续操作前先检查相关文件和进程的实际状态。\n\n{prompt}");
    invocation.session_id = None;
    Ok(Some(format!("Codex 原会话（{session}）有 {count} 个工具调用缺少结果。已保留原记录，并携带最近对话开启新会话；已提示 Agent 先核查未完成操作的实际状态。")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn inspect(items: Vec<Value>) -> Option<usize> {
        let path =
            std::env::temp_dir().join(format!("oiagent-resume-{}.jsonl", uuid::Uuid::new_v4()));
        let mut rows = vec![json!({"type":"session_meta","payload":{"id":"s"}})];
        rows.extend(items);
        std::fs::write(
            &path,
            rows.iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .unwrap();
        let result = missing(&path, "s");
        assert_eq!(missing(&path, "other"), None);
        std::fs::remove_file(path).unwrap();
        result
    }
    fn item(kind: &str, id: &str) -> Value {
        json!({"type":"response_item","payload":{"type":kind,"call_id":id}})
    }
    #[test]
    fn pairs_parallel_calls_by_id_and_type() {
        assert_eq!(
            inspect(vec![
                item("custom_tool_call", "a"),
                item("function_call", "b"),
                item("function_call_output", "b")
            ]),
            Some(1)
        );
        assert_eq!(
            inspect(vec![
                item("custom_tool_call", "a"),
                item("function_call_output", "a")
            ]),
            Some(1)
        );
        assert_eq!(
            inspect(vec![
                item("custom_tool_call", "a"),
                item("function_call", "b"),
                item("function_call_output", "b"),
                item("custom_tool_call_output", "a")
            ]),
            Some(0)
        );
    }
    #[test]
    fn compaction_uses_replacement_history() {
        assert_eq!(
            inspect(vec![
                item("custom_tool_call", "a"),
                json!({"type":"compacted","payload":{"replacement_history":[]}})
            ]),
            Some(0)
        );
        assert_eq!(
            inspect(vec![
                json!({"type":"compacted","payload":{"replacement_history":[{"type":"custom_tool_call","call_id":"b"}]}})
            ]),
            Some(1)
        );
    }
    #[test]
    fn incomplete_latest_rollout_is_not_used_as_evidence_of_missing_outputs() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rollout.jsonl");
        std::fs::write(
            &path,
            format!(
                "{}\n{}\n{{\"type\":",
                json!({"type":"session_meta","payload":{"id":"s"}}),
                item("custom_tool_call", "a")
            ),
        )
        .unwrap();
        assert_eq!(missing(&path, "s"), Some(0));
        assert_eq!(missing(&path, "other"), None);
    }
    #[test]
    fn recovery_carries_context_without_resuming_or_mutating_native_history() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let path = dir.path().join("sessions/rollout-s.jsonl");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let native = format!(
            "{}\n{}\n",
            json!({"type":"session_meta","payload":{"id":"s"}}),
            item("custom_tool_call", "call_missing")
        );
        std::fs::write(&path, &native).unwrap();
        std::fs::write(
            dir.path().join("logs/t.messages.jsonl"),
            json!({"role":"assistant","text":"已检查配置，下一步运行测试","timestamp":"now"})
                .to_string(),
        )
        .unwrap();
        let task: Task = serde_json::from_value(json!({"id":"t","title":"t","prompt":"修复登录","activePrompt":"继续检查","project":"/repo","agentId":"codex","agentKind":"codex","status":"queued","createdAt":"","updatedAt":"","preview":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"read-only","exitCode":null,"sessionId":"s"})).unwrap();
        let env = BTreeMap::from([("CODEX_HOME".into(), dir.path().to_string_lossy().into())]);
        let mut invocation = task.clone();
        invocation.prompt = "继续检查".into();
        let notice = prepare(&state, &task, &env, &mut invocation)
            .unwrap()
            .unwrap();
        assert!(notice.contains("原会话（s）"));
        assert!(invocation.session_id.is_none());
        for text in [
            "已检查配置",
            "继续检查",
            "修复登录",
            "执行结果未知",
            "不要直接重放",
        ] {
            assert!(invocation.prompt.contains(text), "{text}");
        }
        let agent = crate::models::Agent {
            id: "codex".into(),
            name: "Codex".into(),
            kind: "codex".into(),
            executable: "codex".into(),
            args: vec![],
            available: true,
            version: String::new(),
            version_error: None,
            custom: false,
        };
        assert!(!crate::runtime::arguments(&agent, &invocation).contains(&"resume".into()));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), native);
        // A completed call retains ordinary resume, including its original prompt.
        std::fs::write(
            &path,
            format!(
                "{native}{}\n",
                item("custom_tool_call_output", "call_missing")
            ),
        )
        .unwrap();
        let mut healthy = task.clone();
        assert!(prepare(&state, &task, &env, &mut healthy)
            .unwrap()
            .is_none());
        assert_eq!(healthy.prompt, task.prompt);
        assert!(crate::runtime::arguments(&agent, &healthy).contains(&"resume".into()));
    }
}
