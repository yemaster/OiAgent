//! Transient transport progress is not a conversation or execution record.
use crate::store::AppState;
use serde_json::Value;
use tauri::{Emitter, Manager, State};

#[tauri::command]
pub fn task_live_status(state: State<AppState>, id: String) -> Option<String> {
    state.live_status.lock().unwrap().get(&id).cloned()
}

pub fn set<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str, text: Option<String>) {
    let state = app.state::<AppState>();
    let changed = {
        let mut statuses = state.live_status.lock().unwrap();
        if statuses.get(id) == text.as_ref() {
            false
        } else {
            if let Some(text) = &text {
                statuses.insert(id.into(), text.clone());
            } else {
                statuses.remove(id);
            }
            true
        }
    };
    if changed {
        let _ = app.emit("task-live-status", serde_json::json!({"id":id,"text":text}));
    }
}

pub fn reconnect_text(text: &str) -> bool {
    let text = text.trim().to_ascii_lowercase();
    text.starts_with("reconnecting...")
        || text.starts_with("reconnecting…")
        || text.starts_with("reconnecting (")
        || text.starts_with("retrying connection")
}

pub fn reconnect(line: &str, value: Option<&Value>, stderr: bool) -> Option<String> {
    if let Some(v) = value.filter(|v| v["type"] == "system" && v["subtype"] == "api_retry") {
        let attempt = v["attempt"].as_u64()?;
        let total = v["max_retries"].as_u64()?;
        let suffix = v["error_status"]
            .as_u64()
            .map(|s| format!(" · HTTP {s}"))
            .unwrap_or_default();
        return Some(format!("正在重试 {attempt}/{total}{suffix}"));
    }
    let text = match value {
        // Do not inspect tool output, user input or assistant prose for status words.
        Some(v) if matches!(v["type"].as_str(), Some("error" | "warning" | "system")) => v
            ["message"]
            .as_str()
            .or_else(|| v["error"]["message"].as_str())
            .or_else(|| v["error"].as_str())?,
        None if stderr => line,
        _ => return None,
    };
    reconnect_text(text).then(|| text.trim().chars().take(600).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_transport_progress_is_transient() {
        let text = "Reconnecting... 1/5 (workspace routing discovery timed out)";
        assert!(reconnect(text, None, true).is_some());
        assert_eq!(reconnect("", Some(&json!({"type":"system","subtype":"api_retry","attempt":2,"max_retries":5,"error_status":503})), false).as_deref(), Some("正在重试 2/5 · HTTP 503"));
        assert!(reconnect("", Some(&json!({"type":"error","message":text})), false).is_some());
        for typ in ["assistant", "user", "tool_result", "item.completed"] {
            assert!(reconnect("", Some(&json!({"type":typ,"message":text})), false).is_none());
        }
        assert!(reconnect(text, None, false).is_none());
        assert!(reconnect("Connection failed after 5 retries", None, true).is_none());
        assert!(reconnect("Error: model not found", None, true).is_none());
    }
}
