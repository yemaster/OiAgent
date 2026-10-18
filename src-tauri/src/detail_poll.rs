//! Conditional detail polling. File contents are still read by the authoritative
//! detail path; fingerprints only skip work when every input is unchanged.
use crate::{models::TaskDetail, store::AppState};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Update {
    #[serde(flatten)]
    detail: TaskDetail,
    content_version: Option<String>,
}

fn stamp(path: &Path) -> Option<serde_json::Value> {
    match path.metadata() {
        Ok(meta) => {
            let modified = meta
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?;
            Some(serde_json::json!([
                path,
                meta.len(),
                modified.as_secs(),
                modified.subsec_nanos(),
                meta.created()
                    .ok()
                    .and_then(|v| v.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|v| (v.as_secs(), v.subsec_nanos()))
            ]))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Some(serde_json::json!([path, null]))
        }
        Err(_) => None,
    }
}

fn version(state: &AppState, id: &str) -> Result<Option<String>, String> {
    let (task, edited) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        if db.deleted_tasks.contains(id) {
            return Err("记录已删除".into());
        }
        let Some(task) = db.tasks.iter().find(|task| task.id == id) else {
            // Imported histories can acquire a new identity during an index scan;
            // keep their authoritative lookup instead of guessing an index version.
            return Ok(None);
        };
        (
            task.clone(),
            db.conversation_edits
                .values()
                .any(|edit| edit.task_id == id),
        )
    };
    let native = task
        .session_id
        .as_ref()
        .and_then(|sid| {
            state
                .history
                .lock()
                .unwrap()
                .find_session(&task.agent_kind, sid)
        })
        .and_then(|task| task.history_path);
    let mut paths = vec![
        state.dir.join("logs").join(format!("{id}.messages.jsonl")),
        state.log_path(id),
    ];
    if let Some(path) = native {
        paths.push(path.into());
    }
    if let Some(path) = &task.history_path {
        paths.push(path.into());
    }
    let Some(files) = paths
        .iter()
        .map(|path| stamp(path))
        .collect::<Option<Vec<_>>>()
    else {
        return Ok(None);
    };
    let bytes = serde_json::to_vec(&(task, edited, files)).map_err(|e| e.to_string())?;
    Ok(Some(format!("{:x}", Sha256::digest(bytes))))
}

pub(crate) fn poll<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    known: Option<&str>,
) -> Result<Option<Update>, String> {
    let state = app.state::<AppState>();
    if let Some(task) = crate::terminal_history::sync_owner(&state, id)? {
        crate::runtime::emit(app, &task);
    }
    let before = version(&state, id)?;
    if before.is_some() && before.as_deref() == known {
        return Ok(None);
    }
    let detail = crate::detail_inner(app, id)?;
    // A write during the read invalidates the token. The next poll must reread;
    // never claim that a partial snapshot includes an append that arrived later.
    let after = version(&state, id)?;
    let content_version = if before == after { after } else { None };
    Ok(Some(Update {
        detail,
        content_version,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn token_tracks_logs_status_and_deleted_records() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let task = serde_json::from_value(serde_json::json!({"id":"task","title":"title","prompt":"prompt","project":"/repo","agentId":"qodercn","agentKind":"qodercn","status":"running","createdAt":"","updatedAt":"","preview":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"default"})).unwrap();
        state.db.lock().unwrap().tasks.push(task);
        let first = version(&state, "task").unwrap();
        assert!(first.is_some());
        assert_eq!(version(&state, "task").unwrap(), first);
        let path = dir.path().join("logs/task.messages.jsonl");
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(b"first\n").unwrap();
        let second = version(&state, "task").unwrap();
        assert_ne!(first, second);
        file.write_all(b"second\n").unwrap();
        let third = version(&state, "task").unwrap();
        assert_ne!(second, third);
        state.db.lock().unwrap().tasks[0].status = "completed".into();
        let fourth = version(&state, "task").unwrap();
        assert_ne!(third, fourth);
        std::fs::remove_file(&path).unwrap();
        assert_ne!(fourth, version(&state, "task").unwrap());
        state.db.lock().unwrap().deleted_tasks.insert("task".into());
        assert!(version(&state, "task").is_err());
    }
    #[test]
    fn unchanged_poll_skips_payload_but_appends_replacements_and_state_changes_refresh() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let dir = tempfile::tempdir().unwrap();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        app.manage(AppState::load(dir.path().join("app")).unwrap());
        let state = app.state::<AppState>();
        let task = serde_json::from_value(serde_json::json!({"id":"task","title":"title","prompt":"prompt","project":"/repo","agentId":"codex","agentKind":"codex","status":"running","createdAt":"","updatedAt":"","preview":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"read-only"})).unwrap();
        state.db.lock().unwrap().tasks.push(task);
        let message: crate::models::Message = serde_json::from_value(
            serde_json::json!({"role":"user","text":"first","timestamp":"t"}),
        )
        .unwrap();
        crate::runtime::append_record(&state, "task", &message);
        let first = poll(app.handle(), "task", None).unwrap().unwrap();
        assert_eq!(first.detail.messages.len(), 1);
        assert!(first.content_version.is_some());
        assert!(poll(app.handle(), "task", first.content_version.as_deref())
            .unwrap()
            .is_none());
        // Callers without a token (editing, artifacts, older clients) always receive a full detail.
        assert!(poll(app.handle(), "task", None).unwrap().is_some());
        crate::runtime::append_record(&state, "task", &message);
        let appended = poll(app.handle(), "task", first.content_version.as_deref())
            .unwrap()
            .unwrap();
        assert_eq!(appended.detail.messages.len(), 2);
        assert_ne!(first.detail.revision, appended.detail.revision);
        state.db.lock().unwrap().tasks[0].status = "stopped".into();
        let stopped = poll(app.handle(), "task", appended.content_version.as_deref())
            .unwrap()
            .unwrap();
        assert_eq!(stopped.detail.task.status, "stopped");
        let path = state.dir.join("logs/task.messages.jsonl");
        let replacement: crate::models::Message = serde_json::from_value(
            serde_json::json!({"role":"user","text":"replacement","timestamp":"t"}),
        )
        .unwrap();
        std::fs::write(
            &path,
            format!("{}\n", serde_json::to_string(&replacement).unwrap()),
        )
        .unwrap();
        let replaced = poll(app.handle(), "task", stopped.content_version.as_deref())
            .unwrap()
            .unwrap();
        assert_eq!(replaced.detail.messages.len(), 1);
        assert_eq!(replaced.detail.messages[0].text, "replacement");
        // Adding a native history source must also invalidate the conditional token.
        let native = dir.path().join("native.jsonl");
        state.db.lock().unwrap().tasks[0].history_path = Some(native.to_string_lossy().into());
        let before = version(&state, "task").unwrap();
        std::fs::write(native, "new native event\n").unwrap();
        assert_ne!(before, version(&state, "task").unwrap());
    }
}
