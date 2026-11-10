//! Join provider thinking lifecycles without persisting a full snapshot per token.
use crate::models::Message;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timing {
    pub id: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub completed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn text_deltas_arrive_before_final_and_share_block_identity() {
        let mut stream = Stream::default();
        let event =
            |parent, e| json!({"type":"stream_event","parent_tool_use_id":parent,"event":e});
        let mut ids = vec![];
        for parent in [Value::Null, json!("child")] {
            stream.messages(
                &event(
                    parent.clone(),
                    json!({"type":"message_start","message":{"id":"m"}}),
                ),
                "start",
            );
            stream.messages(&event(parent.clone(), json!({"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}})), "start");
            let delta = stream.messages(&event(parent.clone(), json!({"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"正在输出"}})), "delta");
            assert_eq!(delta[0].text, "正在输出");
            assert!(delta[0].delta);
            ids.push(delta[0].stream_id.clone().unwrap());
            let final_rows = stream.messages(&json!({"type":"assistant","uuid":"native","parent_tool_use_id":parent,"message":{"id":"m","content":[{"type":"thinking","thinking":"thought"},{"type":"text","text":"正在输出，完成"}]}}), "end");
            assert_eq!(final_rows[1].stream_id, delta[0].stream_id);
            assert!(!final_rows[1].delta);
            assert_eq!(final_rows[1].native_id.as_deref(), Some("native"));
        }
        assert_ne!(ids[0], ids[1]);
        let update = stream.messages(
            &json!({"type":"item.updated","item":{"type":"agent_message","id":"a","text":"early"}}),
            "update",
        );
        let done = stream.messages(&json!({"type":"item.completed","item":{"type":"agent_message","id":"a","text":"finished"}}), "done");
        assert_eq!(update[0].text, "early");
        assert!(!update[0].delta); // Codex item updates are snapshots, not deltas.
        assert_eq!(update[0].stream_id, done[0].stream_id);
        let resumed = Stream::default().messages(&json!({"type":"item.completed","item":{"type":"agent_message","id":"a","text":"next turn"}}), "next");
        assert_ne!(resumed[0].stream_id, done[0].stream_id);
    }
    #[test]
    fn native_refresh_keeps_stream_duration_without_matching_unrelated_repeated_text() {
        let timing = Timing {
            id: "r".into(),
            started_at: Some("start".into()),
            completed_at: Some("end".into()),
            completed: true,
        };
        let mut managed = row(&timing, "thought", "start", "", false);
        managed.native_id = Some("native-1".into());
        let mut native = vec![managed.clone(), managed.clone()];
        native[0].reasoning = None;
        native[1].reasoning = None;
        native[1].native_id = Some("native-2".into());
        restore_timing(&[managed], &mut native);
        assert_eq!(
            native[0]
                .reasoning
                .as_ref()
                .unwrap()
                .completed_at
                .as_deref(),
            Some("end")
        );
        assert!(native[1].reasoning.is_none());
    }
    #[test]
    fn streams_thinking_with_one_identity_and_authoritative_stop_time() {
        let mut stream = Stream::default();
        let event = |e| json!({"type":"stream_event","event":e});
        assert!(stream
            .messages(
                &event(json!({"type":"message_start","message":{"id":"m"}})),
                "start"
            )
            .is_empty());
        let start = stream.messages(&event(json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}})), "2026-11-02T00:00:00Z");
        let chunk = stream.messages(&event(json!({"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"first"}})), "2026-11-02T00:00:01Z");
        assert!(chunk[0].delta);
        assert_eq!(chunk[0].text, "first");
        assert_eq!(
            chunk[0].reasoning.as_ref().unwrap().id,
            start[0].reasoning.as_ref().unwrap().id
        );
        let stop = stream.messages(
            &event(json!({"type":"content_block_stop","index":0})),
            "2026-11-02T00:00:12Z",
        );
        assert!(stop[0].reasoning.as_ref().unwrap().completed);
        let final_row = stream.messages(&json!({"type":"assistant","message":{"id":"m","content":[{"type":"thinking","thinking":"first and last"}]}}), "2026-11-02T00:00:20Z");
        let timing = final_row[0].reasoning.as_ref().unwrap();
        assert_eq!(timing.id, start[0].reasoning.as_ref().unwrap().id);
        assert_eq!(timing.completed_at.as_deref(), Some("2026-11-02T00:00:12Z"));
        assert!(!final_row[0].delta);
        assert_eq!(final_row[0].text, "first and last");
        // Never expose signed/encrypted thinking as plaintext.
        assert!(stream.messages(&event(json!({"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"secret"}})), "end").is_empty());
    }
    #[test]
    fn tracks_subagents_separately_and_closes_on_message_stop() {
        let mut stream = Stream::default();
        for parent in [Value::Null, json!("child")] {
            stream.messages(&json!({"type":"stream_event","parent_tool_use_id":parent,"event":{"type":"message_start","message":{"id":"m"}}}), "start");
            stream.messages(&json!({"type":"stream_event","parent_tool_use_id":parent,"event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}}), "start");
        }
        let child = stream.messages(&json!({"type":"stream_event","parent_tool_use_id":"child","event":{"type":"message_stop"}}), "end");
        assert_eq!(child[0].parent_call_id.as_deref(), Some("child"));
        let main = stream.messages(
            &json!({"type":"stream_event","event":{"type":"message_stop"}}),
            "end",
        );
        assert_ne!(
            child[0].reasoning.as_ref().unwrap().id,
            main[0].reasoning.as_ref().unwrap().id
        );
        assert!(main[0].reasoning.as_ref().unwrap().completed);
    }
    #[test]
    fn codex_updates_share_timing_but_completed_only_records_do_not_invent_duration() {
        let mut stream = Stream::default();
        stream.messages(
            &json!({"type":"item.started","item":{"id":"r","type":"reasoning","text":"start"}}),
            "start",
        );
        let end = stream.messages(
            &json!({"type":"item.completed","item":{"id":"r","type":"reasoning","text":"done"}}),
            "end",
        );
        assert_eq!(
            end[0].reasoning.as_ref().unwrap().started_at.as_deref(),
            Some("start")
        );
        let historical = stream.messages(
            &json!({"type":"item.completed","item":{"id":"old","type":"reasoning","text":"done"}}),
            "end",
        );
        assert!(historical[0]
            .reasoning
            .as_ref()
            .unwrap()
            .started_at
            .is_none());
    }
}

#[derive(Default)]
struct Request {
    id: String,
    blocks: HashMap<u64, Timing>,
}

pub struct Stream {
    scope: String,
    requests: HashMap<String, Request>,
    items: HashMap<String, Timing>,
}

impl Default for Stream {
    fn default() -> Self {
        Self {
            scope: uuid::Uuid::new_v4().to_string(),
            requests: HashMap::new(),
            items: HashMap::new(),
        }
    }
}

/// Native history replaces some completed transcripts but has no stream timing.
/// Match native identity, parent and block text; repeated prose is not identity.
pub fn restore_timing(managed: &[Message], native: &mut [Message]) {
    let mut observed = HashMap::new();
    for message in managed {
        if let (Some(id), Some(timing)) = (message.native_id.as_deref(), message.reasoning.as_ref())
        {
            if timing.started_at.is_some() && timing.completed {
                observed.insert(
                    (id, message.parent_call_id.as_deref(), message.text.as_str()),
                    timing,
                );
            }
        }
    }
    for message in native.iter_mut().filter(|m| m.role == "reasoning") {
        if let Some(id) = message.native_id.as_deref() {
            if let Some(timing) =
                observed.get(&(id, message.parent_call_id.as_deref(), message.text.as_str()))
            {
                message.reasoning = Some((*timing).clone());
            }
        }
    }
}

fn row(timing: &Timing, text: &str, timestamp: &str, parent: &str, delta: bool) -> Message {
    Message {
        attachments: vec![],
        native_id: None,
        stream_id: None,
        synthetic: None,
        agent_kind: None,
        role: "reasoning".into(),
        text: text.into(),
        timestamp: timestamp.into(),
        tool: None,
        parent_call_id: (!parent.is_empty()).then(|| parent.into()),
        delta,
        reasoning: Some(timing.clone()),
    }
}

fn text_row(
    request: &Request,
    event: &Value,
    timestamp: &str,
    parent: &str,
    delta: bool,
) -> Message {
    let text = if delta {
        &event["delta"]["text"]
    } else {
        &event["content_block"]["text"]
    };
    let mut row = crate::transcript::prose("assistant", text.as_str().unwrap_or(""), timestamp);
    row.parent_call_id = (!parent.is_empty()).then(|| parent.into());
    row.stream_id = Some(crate::transcript::text_id(
        &request.id,
        parent,
        event["index"].as_u64().unwrap_or(0),
    ));
    row.delta = delta;
    row
}

impl Stream {
    pub fn messages(&mut self, v: &Value, timestamp: &str) -> Vec<Message> {
        let mut messages = self.messages_inner(v, timestamp);
        // Codex item IDs restart at item_0 on each resumed CLI process.
        for message in &mut messages {
            if let Some(id) = &mut message.stream_id {
                *id = format!("{}:{id}", self.scope);
            }
            if let Some(timing) = &mut message.reasoning {
                timing.id = format!("{}:{}", self.scope, timing.id);
            }
        }
        messages
    }
    fn messages_inner(&mut self, v: &Value, timestamp: &str) -> Vec<Message> {
        let parent = v["parent_tool_use_id"].as_str().unwrap_or("");
        if v["type"] == "stream_event" {
            let e = &v["event"];
            let request = self.requests.entry(parent.into()).or_default();
            match e["type"].as_str().unwrap_or("") {
                "message_start" => {
                    *request = Request {
                        id: e["message"]["id"].as_str().unwrap_or(timestamp).into(),
                        ..Default::default()
                    };
                }
                "content_block_start" if e["content_block"]["type"] == "text" => {
                    return vec![text_row(request, e, timestamp, parent, false)];
                }
                "content_block_delta" if e["delta"]["type"] == "text_delta" => {
                    return vec![text_row(request, e, timestamp, parent, true)];
                }
                "content_block_start" if e["content_block"]["type"] == "thinking" => {
                    let index = e["index"].as_u64().unwrap_or(0);
                    let timing = Timing {
                        id: format!("{parent}:{}:{index}", request.id),
                        started_at: Some(timestamp.into()),
                        completed_at: None,
                        completed: false,
                    };
                    let message = row(
                        &timing,
                        e["content_block"]["thinking"].as_str().unwrap_or(""),
                        timestamp,
                        parent,
                        false,
                    );
                    request.blocks.insert(index, timing);
                    return vec![message];
                }
                "content_block_delta" if e["delta"]["type"] == "thinking_delta" => {
                    if let Some(timing) = request.blocks.get(&e["index"].as_u64().unwrap_or(0)) {
                        return vec![row(
                            timing,
                            e["delta"]["thinking"].as_str().unwrap_or(""),
                            timestamp,
                            parent,
                            true,
                        )];
                    }
                }
                "content_block_stop" => {
                    if let Some(timing) = request.blocks.get_mut(&e["index"].as_u64().unwrap_or(0))
                    {
                        if timing.completed {
                            return vec![];
                        }
                        timing.completed = true;
                        timing.completed_at = Some(timestamp.into());
                        return vec![row(timing, "", timestamp, parent, true)];
                    }
                }
                "message_stop" => {
                    return request
                        .blocks
                        .values_mut()
                        .filter_map(|timing| {
                            if timing.completed {
                                return None;
                            }
                            timing.completed = true;
                            timing.completed_at = Some(timestamp.into());
                            Some(row(timing, "", timestamp, parent, true))
                        })
                        .collect();
                }
                _ => {}
            }
            return vec![];
        }
        // Codex CLI exposes reasoning item updates on versions that support them.
        let typ = v["type"].as_str().unwrap_or("");
        if matches!(typ, "item.started" | "item.updated" | "item.completed")
            && v["item"]["type"] == "reasoning"
        {
            let id = v["item"]["id"].as_str().unwrap_or(timestamp).to_owned();
            let timing = self.items.entry(id.clone()).or_insert_with(|| Timing {
                id,
                started_at: (typ != "item.completed").then(|| timestamp.into()),
                completed_at: None,
                completed: false,
            });
            timing.completed = typ == "item.completed";
            timing.completed_at = timing.completed.then(|| timestamp.into());
            let message = row(
                timing,
                v["item"]["text"].as_str().unwrap_or(""),
                timestamp,
                parent,
                false,
            );
            if timing.completed {
                self.items.remove(&message.reasoning.as_ref().unwrap().id);
            }
            return vec![message];
        }
        let mut messages = crate::transcript::messages(v, timestamp);
        if v["type"] == "assistant" {
            let request = self
                .requests
                .get(parent)
                .filter(|r| v["message"]["id"].as_str().is_none_or(|id| id == r.id));
            let indices: Vec<_> = v["message"]["content"]
                .as_array()
                .into_iter()
                .flatten()
                .enumerate()
                .filter(|(_, p)| p["type"] == "thinking")
                .map(|(i, _)| i as u64)
                .collect();
            for (message, index) in messages
                .iter_mut()
                .filter(|m| m.role == "reasoning")
                .zip(indices)
            {
                let mut timing = request
                    .and_then(|r| r.blocks.get(&index))
                    .cloned()
                    .unwrap_or_else(|| Timing {
                        id: format!(
                            "{parent}:{}:{index}",
                            v["message"]["id"]
                                .as_str()
                                .or(v["uuid"].as_str())
                                .unwrap_or(timestamp)
                        ),
                        started_at: None,
                        completed_at: None,
                        completed: true,
                    });
                timing.completed = true;
                timing.completed_at.get_or_insert_with(|| timestamp.into());
                message.reasoning = Some(timing);
            }
        }
        messages
    }
}
