//! Background-task envelopes are transport events, not user chat messages.
use quick_xml::{events::Event, Reader};
use serde_json::{json, Map, Value};

/// Process-local lifecycle, never reconstructed from assistant prose or replayed
/// XML: Monitor output notifications can occur while the Monitor is still alive.
#[derive(Default)]
pub struct BackgroundTasks {
    active: std::collections::HashSet<String>,
    finished: std::collections::HashSet<String>,
}
impl BackgroundTasks {
    pub fn is_active(&self) -> bool {
        !self.active.is_empty()
    }
    fn update(&mut self, id: &str, status: &str) {
        if id.is_empty() || id.len() > 512 {
            return;
        }
        match status {
            "completed" | "failed" | "stopped" | "cancelled" => {
                self.active.remove(id);
                self.finished.insert(id.into());
            }
            "running" | "started" | "in_progress" if !self.finished.contains(id) => {
                self.active.insert(id.into());
            }
            _ => {}
        }
    }
    pub fn observe(&mut self, v: &Value) {
        if v["type"] == "system" {
            let subtype = v["subtype"].as_str().unwrap_or("");
            if let Some(id) = v["task_id"].as_str() {
                match subtype {
                    "task_started" | "task_progress" => self.update(id, "running"),
                    "task_notification" | "task_updated" => {
                        self.update(id, v["status"].as_str().unwrap_or(""));
                    }
                    _ => {}
                }
            }
            if subtype == "background_tasks_changed" {
                if let Some(tasks) = v["tasks"].as_array() {
                    // This event is an authoritative snapshot, not a delta.
                    let retained: std::collections::HashSet<String> = tasks
                        .iter()
                        .filter_map(|t| t["task_id"].as_str().map(String::from))
                        .collect();
                    self.active.retain(|id| retained.contains(id));
                    for task in tasks {
                        if let Some(id) = task["task_id"].as_str() {
                            self.update(id, task["status"].as_str().unwrap_or("running"));
                        }
                    }
                }
            }
        } else if v["type"] == "user" {
            let launch = &v["tool_use_result"];
            if launch["kind"] == "backgrounded" {
                if let Some(id) = launch["taskId"].as_str() {
                    self.update(id, "running");
                }
            }
        }
    }
}

pub fn synthetic(v: &Value) -> Option<bool> {
    match v["origin"]["kind"].as_str() {
        Some("human") => Some(false),
        Some("task-notification") => Some(true),
        Some(_) => Some(false),
        None => v["isSynthetic"].as_bool(),
    }
}

/// Read a complete, leading envelope only. Never interpret inline/fenced XML,
/// incomplete records, DTDs, or external entities. Older CLIs omit origin metadata.
pub fn envelope(text: &str) -> Option<(Value, &str)> {
    let line = text.trim_start_matches(['\r', '\n']);
    if line.starts_with("    ") || line.starts_with('\t') || text.len() > 100_000 {
        return None;
    }
    let text = text.trim_start();
    if !text.starts_with("<task-notification>") {
        return None;
    }
    let end = text.find("</task-notification>")? + "</task-notification>".len();
    let mut reader = Reader::from_str(&text[..end]);
    let mut depth = 0;
    let mut key = String::new();
    let mut value = String::new();
    let mut fields = Map::new();
    loop {
        match reader.read_event().ok()? {
            Event::Start(e) => {
                depth += 1;
                if depth > 2 || e.attributes().next().is_some() {
                    return None;
                }
                if depth == 2 {
                    key = e.name().as_ref().replace('-', "_");
                    value.clear();
                }
            }
            Event::Text(e) => {
                let text = e.as_ref();
                if depth == 2 {
                    value.push_str(text);
                } else if !text.trim().is_empty() {
                    return None;
                }
            }
            Event::CData(e) if depth == 2 => value.push_str(e.as_ref()),
            Event::GeneralRef(e) if depth == 2 => {
                if let Some(c) = e.resolve_char_ref().ok()? {
                    value.push(c);
                } else {
                    value.push(match &*e {
                        "amp" => '&',
                        "lt" => '<',
                        "gt" => '>',
                        "quot" => '"',
                        "apos" => '\'',
                        _ => return None,
                    });
                }
            }
            Event::End(_) => {
                if depth == 2 {
                    if fields
                        .insert(key.clone(), Value::String(value.trim().into()))
                        .is_some()
                    {
                        return None;
                    }
                }
                depth -= 1;
            }
            Event::Empty(e) if depth == 1 => {
                if e.attributes().next().is_some() {
                    return None;
                }
                let key = e.name().as_ref().replace('-', "_");
                if fields.insert(key, Value::String(String::new())).is_some() {
                    return None;
                }
            }
            Event::Eof if depth == 0 => break,
            _ => return None,
        }
    }
    let data = Value::Object(fields);
    event(&data)?;
    Some((data, text[end..].trim_start_matches(['\r', '\n'])))
}

pub fn event(v: &Value) -> Option<Value> {
    let id = v["task_id"].as_str()?.trim();
    if id.is_empty() || id.len() > 512 {
        return None;
    }
    let status = match v["subtype"].as_str() {
        Some("task_started" | "task_progress") => "running",
        _ => v["status"].as_str()?,
    };
    let state = match status {
        "running" | "in_progress" | "started" => "running",
        "completed" | "stopped" | "cancelled" => "completed",
        "failed" => "failed",
        _ => return None,
    };
    Some(json!({
        "callId": format!("task-notification:{id}"),
        "name": "task_notification",
        "input": {"taskId":id,"status":status,"description":v["description"],"toolUseId":v["tool_use_id"]},
        "output": {"summary":v["summary"],"result":v["result"],"outputFile":v["output_file"],"usage":v["usage"]},
        "state":state,"childIds":[id],
    }))
}

/// Exclude notification envelopes from the first user prompt used for indexing.
pub fn prompt<'a>(v: &Value, text: &'a str) -> &'a str {
    if synthetic(v) == Some(false) {
        return text;
    }
    let mut rest = text;
    while let Some((_, tail)) = envelope(rest) {
        rest = tail;
    }
    if synthetic(v) == Some(true) {
        ""
    } else {
        rest
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript::messages;

    #[test]
    fn native_lifecycle_ignores_replays_and_late_progress() {
        let mut tasks = BackgroundTasks::default();
        tasks.observe(&json!({"type":"system","subtype":"task_started","task_id":"one"}));
        tasks.observe(
            &json!({"type":"user","tool_use_result":{"kind":"backgrounded","taskId":"two"}}),
        );
        assert!(tasks.is_active());
        tasks.observe(&json!({"type":"user","isSynthetic":true,"origin":{"kind":"task-notification"},"message":{"content":XML}}));
        tasks.observe(&json!({"type":"system","subtype":"task_notification","task_id":"one","status":"completed"}));
        assert!(tasks.is_active());
        tasks.observe(
            &json!({"type":"system","subtype":"task_updated","task_id":"two","status":"stopped"}),
        );
        assert!(!tasks.is_active());
        tasks.observe(&json!({"type":"system","subtype":"task_progress","task_id":"one"}));
        assert!(!tasks.is_active());
    }
    #[test]
    fn snapshots_remove_finished_tasks_but_unknown_frames_do_not() {
        let mut tasks = BackgroundTasks::default();
        tasks.observe(&json!({"type":"system","subtype":"background_tasks_changed","tasks":[{"task_id":"watcher","status":"running"}]}));
        tasks.observe(&json!({"type":"system","subtype":"future_event","tasks":[]}));
        assert!(tasks.is_active());
        tasks.observe(&json!({"type":"result","origin":{"kind":"task-notification"}}));
        assert!(tasks.is_active());
        tasks.observe(&json!({"type":"system","subtype":"background_tasks_changed","tasks":[]}));
        assert!(!tasks.is_active());
    }

    const XML: &str = "<task-notification><task-id>child-1</task-id><tool-use-id>call-1</tool-use-id><status>completed</status><summary>检查 &amp; 修复 &#x6587;件</summary><result><![CDATA[all <checks> passed]]></result><output-file>/tmp/result.txt</output-file></task-notification>";

    #[test]
    fn replay_becomes_task_event_with_readable_fields() {
        for content in [json!(XML), json!([{"type":"text","text":XML}])] {
            let rows = messages(
                &json!({"type":"user","isSynthetic":true,"origin":{"kind":"task-notification"},"message":{"content":content},"parent_tool_use_id":"parent"}),
                "now",
            );
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].role, "tool");
            assert_eq!(rows[0].parent_call_id.as_deref(), Some("parent"));
            let tool = rows[0].tool.as_ref().unwrap();
            assert_eq!(tool["callId"], "task-notification:child-1");
            assert_eq!(tool["output"]["summary"], "检查 & 修复 文件");
            assert_eq!(tool["output"]["result"], "all <checks> passed");
            assert_eq!(tool["childIds"][0], "child-1");
        }
    }
    #[test]
    fn lifecycle_uses_same_identity_without_changing_parent_task_status() {
        for (subtype, status, state) in [
            ("task_started", "", "running"),
            ("task_progress", "", "running"),
            ("task_notification", "failed", "failed"),
            ("task_notification", "stopped", "completed"),
        ] {
            let rows = messages(
                &json!({"type":"system","subtype":subtype,"task_id":"child-1","status":status,"summary":"报告","usage":{"total_tokens":23}}),
                "now",
            );
            assert_eq!(rows.len(), 1);
            let tool = rows[0].tool.as_ref().unwrap();
            assert_eq!(tool["callId"], "task-notification:child-1");
            assert_eq!(tool["state"], state);
            assert_eq!(tool["output"]["usage"]["total_tokens"], 23);
        }
    }
    #[test]
    fn preserves_human_examples_malformed_and_unrecognized_envelopes() {
        for text in [
            format!("解释 {XML}"),
            format!("```xml\n{XML}\n```"),
            format!("    {XML}"),
            XML.replace("</status>", "</broken>"),
            XML.replace("completed", "future-status"),
            XML.replace("&amp;", "&external;"),
            XML.replace("</task-notification>", ""),
        ] {
            assert!(envelope(&text).is_none(), "{text}");
            let rows = messages(&json!({"type":"user","message":{"content":text}}), "now");
            assert_eq!(rows[0].role, "user");
        }
        for metadata in [
            json!({"origin":{"kind":"human"}}),
            json!({"isSynthetic":false}),
            json!({"origin":{"kind":"future"}}),
        ] {
            let mut event = json!({"type":"user","message":{"content":XML}});
            event
                .as_object_mut()
                .unwrap()
                .extend(metadata.as_object().unwrap().clone());
            let rows = messages(&event, "now");
            assert_eq!(rows[0].text, XML);
            assert_eq!(rows[0].synthetic, Some(false));
        }
    }
    #[test]
    fn keeps_following_prompt_and_multiple_notifications() {
        let text = format!("{XML}\n{XML}\n继续修复");
        let rows = messages(&json!({"type":"user","message":{"content":text}}), "now");
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[2].text, "继续修复");
        assert_eq!(prompt(&json!({}), &text), "继续修复");
        assert_eq!(prompt(&json!({"isSynthetic":true}), &text), "");
        assert!(messages(
            &json!({"type":"result","origin":{"kind":"task-notification"},"result":"最终回答"}),
            "now"
        )
        .iter()
        .all(|m| m.tool.is_none()));
    }
}
