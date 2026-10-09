//! Provider records become stable tool events; the UI joins call/result by ID.
use crate::{
    history::{short, string, text_content},
    models::Message,
};
use serde_json::{json, Value};

fn decoded(v: &Value) -> Value {
    v.as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| v.clone())
}
fn bounded(v: &Value) -> Value {
    match v {
        Value::String(s) if s.chars().count() > 50000 => {
            Value::String(format!("{}\n[内容过长，已截断]", short(s, 50000)))
        }
        Value::Array(a) => Value::Array(a.iter().take(200).map(bounded).collect()),
        Value::Object(o) => Value::Object(
            o.iter()
                .map(|(k, v)| {
                    (
                        k.clone(),
                        if ["data", "encrypted_content", "signature"].contains(&k.as_str()) {
                            Value::String("[已省略二进制或签名数据]".into())
                        } else {
                            bounded(v)
                        },
                    )
                })
                .collect(),
        ),
        _ => v.clone(),
    }
}
fn child_ids(v: &Value) -> Vec<String> {
    let v = decoded(v);
    let mut ids = vec![];
    for key in ["agent_id", "agentId", "new_thread_id", "receiver_thread_id"] {
        if let Some(id) = v[key].as_str() {
            ids.push(id.to_string());
        }
    }
    for key in ["receiver_thread_ids", "agent_ids"] {
        if let Some(a) = v[key].as_array() {
            ids.extend(a.iter().filter_map(Value::as_str).map(String::from));
        }
    }
    if let Some(a) = v.as_array() {
        for p in a {
            if let Some(t) = p["text"].as_str() {
                ids.extend(child_ids(&Value::String(t.into())));
            }
        }
    }
    ids.sort();
    ids.dedup();
    ids
}
fn tool(
    id: &str,
    name: &str,
    input: Value,
    output: Value,
    state: &str,
    timestamp: &str,
    parent: &Value,
    children: Vec<String>,
) -> Message {
    Message {
        agent_kind: None,
        role: "tool".into(),
        text: name.into(),
        timestamp: timestamp.into(),
        parent_call_id: None,
        delta: false,
        tool: Some(json!({
            "callId": id, "name": name, "input": bounded(&decoded(&input)), "output": bounded(&output), "state": state,
            "childIds": children, "parentCallId": parent.as_str(),
        })),
    }
}
fn prose(role: &str, text: &str, timestamp: &str) -> Message {
    Message {
        agent_kind: None,
        role: role.into(),
        text: short(text, 50000),
        timestamp: timestamp.into(),
        tool: None,
        parent_call_id: None,
        delta: false,
    }
}
/// Only displayable transcript events. Never expose encrypted reasoning payloads.
pub fn messages(v: &Value, timestamp: &str) -> Vec<Message> {
    let mut out = vec![];
    let typ = string(v, "type");
    let parent = &v["parent_tool_use_id"];
    if typ == "message" && v["content"].is_string() {
        let mut m = prose(&string(v, "role"), &string(v, "content"), timestamp);
        m.delta = v["delta"] == true;
        out.push(m);
    } else if typ == "tool_use" && v["tool_name"].is_string() {
        out.push(tool(
            &string(v, "tool_id"),
            &string(v, "tool_name"),
            v["parameters"].clone(),
            Value::Null,
            "called",
            timestamp,
            parent,
            vec![],
        ));
    } else if typ == "tool_result" && v["tool_id"].is_string() {
        out.push(tool(
            &string(v, "tool_id"),
            "",
            Value::Null,
            v.get("output")
                .or(v.get("error"))
                .cloned()
                .unwrap_or_default(),
            if v["status"] == "error" {
                "failed"
            } else {
                "completed"
            },
            timestamp,
            parent,
            vec![],
        ));
    } else if v["part"].is_object() {
        let p = &v["part"];
        match typ.as_str() {
            "text" => out.push(prose("assistant", &string(p, "text"), timestamp)),
            "reasoning" => out.push(prose("reasoning", &string(p, "text"), timestamp)),
            "tool_use" => {
                let state = &p["state"];
                let mut ids = child_ids(&state["metadata"]);
                if p["tool"] == "task" {
                    if let Some(sid) = state["metadata"]["sessionId"].as_str() {
                        ids.push(sid.into());
                    }
                }
                out.push(tool(
                    p["callID"].as_str().or(p["id"].as_str()).unwrap_or(""),
                    &string(p, "tool"),
                    state["input"].clone(),
                    state
                        .get("output")
                        .or(state.get("error"))
                        .cloned()
                        .unwrap_or_default(),
                    if state["status"] == "error" {
                        "failed"
                    } else if state["status"] == "completed" {
                        "completed"
                    } else {
                        "running"
                    },
                    timestamp,
                    parent,
                    ids,
                ));
            }
            _ => {}
        }
    } else if typ == "response_item" {
        let p = &v["payload"];
        let pt = string(p, "type");
        match pt.as_str() {
            "message" => {
                let role = string(p, "role");
                if ["assistant", "user"].contains(&role.as_str()) {
                    let text = text_content(&p["content"]);
                    if !text.is_empty() {
                        out.push(prose(&role, &text, timestamp));
                    }
                }
            }
            "function_call" | "custom_tool_call" => {
                let name = string(p, "name");
                let namespace = string(p, "namespace");
                let name = if namespace.is_empty() {
                    name
                } else {
                    format!("{namespace}.{name}")
                };
                out.push(tool(
                    &string(p, "call_id"),
                    &name,
                    p.get("arguments")
                        .or(p.get("input"))
                        .cloned()
                        .unwrap_or_default(),
                    Value::Null,
                    "called",
                    timestamp,
                    parent,
                    vec![],
                ));
            }
            "function_call_output" | "custom_tool_call_output" => {
                out.push(tool(
                    &string(p, "call_id"),
                    "",
                    Value::Null,
                    p["output"].clone(),
                    "completed",
                    timestamp,
                    parent,
                    child_ids(&p["output"]),
                ));
            }
            "reasoning" => {
                let text = text_content(&p["summary"]);
                if !text.is_empty() {
                    out.push(prose("reasoning", &text, timestamp));
                }
            }
            _ => {}
        }
    } else if ["assistant", "user", "tool_result"].contains(&typ.as_str()) {
        let content = v["message"].get("content").or(v["message"].get("parts"));
        if let Some(Value::String(s)) = content {
            if !s.is_empty() {
                out.push(prose(&typ, s, timestamp));
            }
        } else if let Some(parts) = content.and_then(Value::as_array) {
            for p in parts {
                if p["type"] == "tool_use" {
                    out.push(tool(
                        &string(p, "id"),
                        &string(p, "name"),
                        p["input"].clone(),
                        Value::Null,
                        "called",
                        timestamp,
                        parent,
                        vec![],
                    ));
                } else if p["type"] == "tool_result" {
                    let mut children = child_ids(&v["toolUseResult"]);
                    children.extend(child_ids(&p["content"]));
                    out.push(tool(
                        &string(p, "tool_use_id"),
                        "",
                        Value::Null,
                        p["content"].clone(),
                        if p["is_error"] == true {
                            "failed"
                        } else {
                            "completed"
                        },
                        timestamp,
                        parent,
                        children,
                    ));
                } else if p["functionCall"].is_object() {
                    let call = &p["functionCall"];
                    out.push(tool(
                        &string(call, "id"),
                        &string(call, "name"),
                        call["args"].clone(),
                        Value::Null,
                        "called",
                        timestamp,
                        parent,
                        vec![],
                    ));
                } else if p["functionResponse"].is_object() {
                    let r = &p["functionResponse"];
                    let id = r["id"]
                        .as_str()
                        .or(v["toolCallResult"]["callId"].as_str())
                        .unwrap_or("");
                    let failed = v["toolCallResult"]["status"] == "error"
                        || r["response"].get("error").is_some_and(|v| !v.is_null());
                    out.push(tool(
                        id,
                        &string(r, "name"),
                        Value::Null,
                        r["response"].clone(),
                        if failed { "failed" } else { "completed" },
                        timestamp,
                        parent,
                        child_ids(&r["response"]),
                    ));
                } else {
                    let text = p["text"].as_str().or(p["thinking"].as_str()).unwrap_or("");
                    if !text.is_empty() {
                        out.push(prose(
                            if p["thought"] == true || p["type"] == "thinking" {
                                "reasoning"
                            } else {
                                &typ
                            },
                            text,
                            timestamp,
                        ));
                    }
                }
            }
        }
    } else if ["item.started", "item.updated", "item.completed"].contains(&typ.as_str()) {
        let item = &v["item"];
        let kind = string(item, "type");
        let id = string(item, "id");
        let state =
            if item["status"] == "failed" || item["exit_code"].as_i64().is_some_and(|n| n != 0) {
                "failed"
            } else if typ == "item.completed" {
                "completed"
            } else {
                "running"
            };
        match kind.as_str() {
            "agent_message" if typ == "item.completed" => {
                out.push(prose("assistant", &string(item, "text"), timestamp))
            }
            "reasoning" if typ == "item.completed" => {
                out.push(prose("reasoning", &string(item, "text"), timestamp))
            }
            "command_execution" => out.push(tool(
                &id,
                "shell",
                json!({"command":item["command"]}),
                if typ == "item.started" {
                    Value::Null
                } else {
                    json!({"output":item["aggregated_output"],"exit_code":item["exit_code"]})
                },
                state,
                timestamp,
                parent,
                vec![],
            )),
            "file_change" => out.push(tool(
                &id,
                "file_change",
                json!({"changes":item["changes"]}),
                Value::Null,
                state,
                timestamp,
                parent,
                vec![],
            )),
            "mcp_tool_call" => out.push(tool(
                &id,
                &format!("{}.{}", string(item, "server"), string(item, "tool")),
                item["arguments"].clone(),
                item.get("result")
                    .or(item.get("error"))
                    .cloned()
                    .unwrap_or_default(),
                state,
                timestamp,
                parent,
                vec![],
            )),
            "web_search" => out.push(tool(
                &id,
                "web_search",
                json!({"query":item["query"]}),
                item.get("results").cloned().unwrap_or_default(),
                state,
                timestamp,
                parent,
                vec![],
            )),
            "todo_list" => out.push(tool(
                &id,
                "update_plan",
                json!({"plan":item["items"]}),
                Value::Null,
                state,
                timestamp,
                parent,
                vec![],
            )),
            "collab_tool_call" => out.push(tool(
                &id,
                &string(item, "tool"),
                json!({"prompt":item["prompt"],"receiver_thread_ids":item["receiver_thread_ids"]}),
                item.get("agents_states").cloned().unwrap_or_default(),
                state,
                timestamp,
                parent,
                child_ids(item),
            )),
            _ => {}
        }
    } else if typ == "event_msg" {
        let p = &v["payload"];
        let pt = string(p, "type");
        if pt.starts_with("collab_") {
            let name = if pt.contains("spawn") {
                "spawn_agent"
            } else if pt.contains("waiting") {
                "wait_agent"
            } else if pt.contains("close") {
                "close_agent"
            } else {
                "send_message"
            };
            let state = if pt.ends_with("_begin") {
                "running"
            } else {
                "completed"
            };
            out.push(tool(
                &string(p, "call_id"),
                name,
                json!({"prompt":p["prompt"]}),
                if state == "completed" {
                    p.clone()
                } else {
                    Value::Null
                },
                state,
                timestamp,
                parent,
                child_ids(p),
            ));
        }
    }
    for message in &mut out {
        message.parent_call_id = parent.as_str().map(String::from);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_retains_call_identity_and_decodes_arguments() {
        let call = messages(
            &json!({"type":"response_item","payload":{"type":"function_call","namespace":"functions","name":"exec_command","call_id":"c1","arguments":"{\"cmd\":\"cargo test\"}"}}),
            "now",
        );
        let result = messages(
            &json!({"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":[{"type":"input_text","text":"{\"exit_code\":0,\"output\":\"passed\"}"}]}}),
            "later",
        );
        assert_eq!(call[0].tool.as_ref().unwrap()["callId"], "c1");
        assert_eq!(call[0].tool.as_ref().unwrap()["input"]["cmd"], "cargo test");
        assert_eq!(result[0].tool.as_ref().unwrap()["callId"], "c1");
        assert_eq!(
            result[0].tool.as_ref().unwrap()["output"][0]["type"],
            "input_text"
        );
    }
    #[test]
    fn claude_preserves_block_order_and_subagent_linkage() {
        let rows = messages(
            &json!({"type":"assistant","message":{"content":[{"type":"text","text":"Checking"},{"type":"tool_use","id":"agent-call","name":"Agent","input":{"description":"Explore"}}]}}),
            "now",
        );
        assert_eq!(rows[0].role, "assistant");
        assert_eq!(rows[1].tool.as_ref().unwrap()["name"], "Agent");
        let result = messages(
            &json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"agent-call","content":[{"type":"text","text":"done"}]}]},"toolUseResult":{"agentId":"child1"}}),
            "later",
        );
        assert_eq!(result[0].tool.as_ref().unwrap()["childIds"][0], "child1");
        let child = messages(
            &json!({"type":"assistant","parent_tool_use_id":"agent-call","message":{"content":[{"type":"text","text":"child report"}]}}),
            "later",
        );
        assert_eq!(child[0].parent_call_id.as_deref(), Some("agent-call"));
    }
    #[test]
    fn qwen_result_is_not_dropped_or_presented_as_user_prose() {
        let rows = messages(
            &json!({"type":"tool_result","message":{"parts":[{"functionResponse":{"id":"q1","name":"read_file","response":{"output":"file text"}}}]}}),
            "now",
        );
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].role, "tool");
        assert_eq!(rows[0].tool.as_ref().unwrap()["callId"], "q1");
    }
    #[test]
    fn failed_command_and_live_tool_lifecycle_are_explicit() {
        let event = |typ: &str| json!({"type":typ,"item":{"id":"x","type":"command_execution","command":"false","exit_code":1,"aggregated_output":"failed"}});
        let rows = messages(&event("item.completed"), "now");
        assert_eq!(rows[0].tool.as_ref().unwrap()["state"], "failed");
        assert_eq!(rows[0].tool.as_ref().unwrap()["output"]["exit_code"], 1);
    }
    #[test]
    fn gemini_stream_chunks_and_tool_events_are_supported() {
        let text = messages(
            &json!({"type":"message","role":"assistant","content":"hello","delta":true}),
            "now",
        );
        assert!(text[0].delta);
        let rows = messages(
            &json!({"type":"tool_result","tool_id":"g1","status":"error","error":{"message":"denied"}}),
            "now",
        );
        assert_eq!(rows[0].tool.as_ref().unwrap()["callId"], "g1");
        assert_eq!(rows[0].tool.as_ref().unwrap()["state"], "failed");
    }
    #[test]
    fn opencode_text_and_tools_have_readable_payloads() {
        let rows = messages(
            &json!({"type":"tool_use","sessionID":"s","part":{"id":"p","callID":"o1","tool":"bash","state":{"status":"completed","input":{"command":"ls"},"output":"src"}}}),
            "now",
        );
        assert_eq!(rows[0].tool.as_ref().unwrap()["callId"], "o1");
        assert_eq!(rows[0].tool.as_ref().unwrap()["output"], "src");
        let text = messages(&json!({"type":"text","part":{"text":"done"}}), "now");
        assert_eq!(text[0].text, "done");
    }
}
