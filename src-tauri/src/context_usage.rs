//! Latest request occupancy, deliberately separate from cumulative billing usage.
use crate::models::Task;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    /// Native occupancy can be available even when Qoder withholds token counts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ratio: Option<f64>,
    pub input: Option<u64>,
    pub output: Option<u64>,
    pub cached: Option<u64>,
    pub window: Option<u64>,
    #[serde(default)]
    pub observed_at: Option<String>,
}
fn num(v: &Value, key: &str) -> Option<u64> {
    v[key].as_u64()
}
pub fn observe(task: &mut Task, v: &Value) {
    if v["parent_tool_use_id"].is_string() || v["isSidechain"] == true {
        return;
    }
    let typ = v["type"].as_str().unwrap_or("");
    let p = &v["payload"];
    let reported = if typ == "turn_context" {
        p["model"].as_str()
    } else if typ == "assistant" {
        v["message"]["model"].as_str()
    } else if typ == "init"
        || typ == "runtime-config"
        || (typ == "system" && v["subtype"] == "init")
    {
        v["model"].as_str()
    } else {
        None
    };
    if let Some(model) = reported.filter(|model| !model.is_empty()) {
        if task.model != model {
            task.context_usage = None;
            task.model = model.into();
        }
    }
    let reset = (typ == "system" && v["subtype"] == "compact_boundary")
        || typ == "compacted"
        || (typ == "event_msg" && p["type"] == "context_compacted")
        || (typ == "system" && (v["status"] == "compacting" || v["compact_result"] == "success"));
    if reset {
        if let Some(usage) = &mut task.context_usage {
            usage.input = None;
            usage.output = None;
            usage.cached = None;
            usage.ratio = None;
            usage.observed_at = Some(
                v["timestamp"]
                    .as_str()
                    .map(String::from)
                    .unwrap_or_else(crate::models::now),
            );
        }
        return;
    }
    let mut current = task.context_usage.clone().unwrap_or_default();
    if task.agent_kind == "codex" {
        let info = if typ == "event_msg" && p["type"] == "token_count" {
            &p["info"]
        } else if typ == "token_usage_record" {
            p
        } else {
            &Value::Null
        };
        let usage = &info["last_token_usage"];
        if let Some(input) = num(usage, "input_tokens") {
            current.input = Some(input);
            current.output = num(usage, "output_tokens");
            current.cached = num(usage, "cached_input_tokens");
        }
        current.window = num(info, "model_context_window")
            .filter(|n| *n > 0)
            .or(current.window);
        if v["method"] == "thread/tokenUsage/updated" {
            let usage = &v["params"]["tokenUsage"];
            current.input = num(&usage["last"], "inputTokens");
            current.output = num(&usage["last"], "outputTokens");
            current.cached = num(&usage["last"], "cachedInputTokens");
            current.window = num(usage, "modelContextWindow")
                .filter(|n| *n > 0)
                .or(current.window);
        }
    } else if ["claude", "qodercn"].contains(&task.agent_kind.as_str()) {
        let usage = if typ == "assistant" {
            &v["message"]["usage"]
        } else if typ == "stream_event" && v["event"]["type"] == "message_start" {
            &v["event"]["message"]["usage"]
        } else {
            &Value::Null
        };
        let empty_partial = task.agent_kind == "qodercn"
            && typ == "stream_event"
            && [
                "input_tokens",
                "output_tokens",
                "cache_read_input_tokens",
                "cache_creation_input_tokens",
            ]
            .iter()
            .all(|key| num(usage, key).unwrap_or(0) == 0);
        if usage.is_object() && !empty_partial {
            let withheld = task.agent_kind == "qodercn" && qoder_tokens_withheld(usage);
            let ratio = usage["context_usage_ratio"]
                .as_f64()
                .filter(|n| n.is_finite() && *n >= 0.0 && *n <= 1.0);
            current.ratio = if withheld {
                ratio.or(current.ratio)
            } else {
                ratio
            };
            if withheld {
                current.input = None;
                current.output = None;
                current.cached = None;
            } else {
                if let Some(input) = num(usage, "input_tokens") {
                    let cached = num(usage, "cache_read_input_tokens").unwrap_or(0);
                    current.input =
                        Some(input.saturating_add(cached).saturating_add(
                            num(usage, "cache_creation_input_tokens").unwrap_or(0),
                        ));
                    current.output = num(usage, "output_tokens");
                    current.cached = Some(cached);
                }
            }
        }
        if typ == "stream_event" && v["event"]["type"] == "message_delta" && current.input.is_some()
        {
            current.output = num(&v["event"]["usage"], "output_tokens").or(current.output);
        }
        // modelUsage is cumulative; only its explicit model capacity is usable here.
        if let Some(window) = v["modelUsage"][&task.model]["contextWindow"]
            .as_u64()
            .filter(|n| *n > 0)
        {
            current.window = Some(window);
        }
        if task.agent_kind == "qodercn" {
            // Result token totals are cumulative. Only its native ratio is occupancy.
            if typ == "result" {
                current.ratio = v["usage"]["context_usage_ratio"]
                    .as_f64()
                    .filter(|n| n.is_finite() && *n >= 0.0 && *n <= 1.0)
                    .or(current.ratio);
            }
            current.window = num(v, "context_window")
                .or_else(|| num(v, "contextWindow"))
                .filter(|n| *n > 0)
                .or(current.window);
            if let Some(window) = task
                .extra_args
                .windows(2)
                .find(|pair| pair[0] == "--context-window")
                .and_then(|pair| pair[1].parse::<u64>().ok())
                .filter(|n| *n > 0)
            {
                current.window = Some(window);
            }
        }
    } else if task.agent_kind == "qwen" && typ == "assistant" {
        let usage = &v["usageMetadata"];
        if let Some(input) = num(usage, "promptTokenCount") {
            current.input = Some(input);
            current.output = num(usage, "candidatesTokenCount");
            current.cached = num(usage, "cachedContentTokenCount");
        }
    }
    if current != task.context_usage.clone().unwrap_or_default() {
        current.observed_at = Some(
            v["timestamp"]
                .as_str()
                .map(String::from)
                .unwrap_or_else(crate::models::now),
        );
        task.context_usage = Some(current);
    }
}

/// Newer Qoder releases meter in credits and send zero-filled token fields.
pub fn qoder_tokens_withheld(usage: &Value) -> bool {
    [
        "input_tokens",
        "output_tokens",
        "cache_read_input_tokens",
        "cache_creation_input_tokens",
    ]
    .iter()
    .all(|key| num(usage, key).unwrap_or(0) == 0)
        && (usage.get("context_usage_ratio").is_some() || usage.get("credits").is_some())
}

/// An older history index must not undo a just-completed manual compaction.
pub fn merge_native(task: &mut Task, native: &Task) {
    let compatible =
        task.model.is_empty() || task.model == "默认模型" || native.model == task.model;
    if !compatible || native.context_usage.is_none() {
        return;
    }
    let timestamp = |usage: Option<&ContextUsage>| {
        usage
            .and_then(|u| u.observed_at.as_deref())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
    };
    let newer = match (
        timestamp(native.context_usage.as_ref()),
        timestamp(task.context_usage.as_ref()),
    ) {
        (Some(incoming), Some(current)) => incoming > current,
        (Some(_), None) => true,
        _ => task.context_usage.is_none(),
    };
    if newer {
        task.context_usage = native.context_usage.clone();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn task(kind: &str) -> Task {
        serde_json::from_value(json!({"id":"context","title":"t","prompt":"p","project":"/tmp","agentId":kind,"agentKind":kind,"status":"completed","createdAt":"","updatedAt":"","preview":"","usage":{"input":900000,"output":80000,"cached":0,"known":true},"source":"managed","model":"test","permission":"default"})).unwrap()
    }
    #[test]
    fn qoder_ratio_survives_zero_filled_tokens_and_does_not_use_cumulative_counts() {
        let mut t = task("qodercn");
        observe(
            &mut t,
            &json!({"type":"assistant","message":{"model":"test","usage":{"input_tokens":0,"output_tokens":0,"credits":0.12,"context_usage_ratio":0.33815}},"context_window":200000}),
        );
        let usage = t.context_usage.as_ref().unwrap();
        assert_eq!(usage.ratio, Some(0.33815));
        assert_eq!(usage.input, None);
        assert_eq!(usage.window, Some(200000));
        observe(
            &mut t,
            &json!({"type":"stream_event","event":{"type":"message_start","message":{"usage":{"input_tokens":0,"output_tokens":0}}}}),
        );
        assert_eq!(t.context_usage.as_ref().unwrap().ratio, Some(0.33815));
        assert_eq!(t.context_usage.as_ref().unwrap().input, None);
        assert!(
            !crate::history::usage(&json!({"input_tokens":0,"output_tokens":0,"credits":0.12}))
                .known
        );
        observe(
            &mut t,
            &json!({"type":"result","usage":{"input_tokens":999999,"output_tokens":90000,"context_usage_ratio":0.4}}),
        );
        assert_eq!(t.context_usage.as_ref().unwrap().input, None);
        assert_eq!(t.context_usage.as_ref().unwrap().ratio, Some(0.4));
        observe(
            &mut t,
            &json!({"type":"assistant","parent_tool_use_id":"child","message":{"usage":{"context_usage_ratio":0.9}}}),
        );
        assert_eq!(t.context_usage.as_ref().unwrap().ratio, Some(0.4));
        observe(&mut t, &json!({"type":"compacted"}));
        assert_eq!(t.context_usage.as_ref().unwrap().ratio, None);
        assert_eq!(t.context_usage.as_ref().unwrap().window, Some(200000));
    }
    #[test]
    fn partial_usage_and_real_qoder_token_counts_are_preserved() {
        let mut t = task("qodercn");
        observe(
            &mut t,
            &json!({"type":"stream_event","event":{"type":"message_start","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":20}}}}),
        );
        observe(
            &mut t,
            &json!({"type":"stream_event","event":{"type":"message_delta","usage":{"output_tokens":5}}}),
        );
        assert_eq!(t.context_usage.as_ref().unwrap().input, Some(120));
        assert_eq!(t.context_usage.as_ref().unwrap().output, Some(5));
        observe(
            &mut t,
            &json!({"type":"runtime-config","model":"new","contextWindow":1000000}),
        );
        assert_eq!(t.context_usage.as_ref().unwrap().input, None);
        assert_eq!(t.context_usage.as_ref().unwrap().window, Some(1000000));
    }
    #[test]
    fn codex_uses_last_request_not_totals_and_resets_after_compaction() {
        let mut t = task("codex");
        observe(
            &mut t,
            &json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":900000},"last_token_usage":{"input_tokens":18000,"output_tokens":2000,"cached_input_tokens":12000},"model_context_window":200000}}}),
        );
        assert_eq!(t.context_usage.as_ref().unwrap().input, Some(18000));
        assert_eq!(t.context_usage.as_ref().unwrap().window, Some(200000));
        observe(&mut t, &json!({"type":"compacted"}));
        assert_eq!(t.context_usage.as_ref().unwrap().input, None);
        observe(
            &mut t,
            &json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":950000}}}}),
        );
        assert_eq!(t.context_usage.as_ref().unwrap().input, None);
    }
    #[test]
    fn cached_tokens_count_once_and_subagents_do_not_replace_context() {
        let mut t = task("claude");
        let event = json!({"type":"assistant","message":{"usage":{"input_tokens":100,"cache_read_input_tokens":200,"cache_creation_input_tokens":50,"output_tokens":10}}});
        observe(&mut t, &event);
        observe(&mut t, &event);
        assert_eq!(t.context_usage.as_ref().unwrap().input, Some(350));
        observe(
            &mut t,
            &json!({"type":"assistant","parent_tool_use_id":"child","message":{"usage":{"input_tokens":9}}}),
        );
        assert_eq!(t.context_usage.as_ref().unwrap().input, Some(350));
        observe(
            &mut t,
            &json!({"type":"result","usage":{"input_tokens":999999},"modelUsage":{"test":{"inputTokens":999999,"contextWindow":200000}}}),
        );
        assert_eq!(t.context_usage.as_ref().unwrap().input, Some(350));
        assert_eq!(t.context_usage.as_ref().unwrap().window, Some(200000));
    }
    #[test]
    fn default_models_use_native_context_but_stale_snapshots_cannot_restore_old_usage() {
        let mut local = task("codex");
        local.model.clear();
        let mut native = task("codex");
        native.context_usage = Some(ContextUsage {
            input: Some(1000),
            window: Some(200000),
            observed_at: Some("2026-10-30T12:00:00Z".into()),
            ..Default::default()
        });
        merge_native(&mut local, &native);
        assert_eq!(local.context_usage.as_ref().unwrap().input, Some(1000));
        observe(
            &mut local,
            &json!({"type":"compacted","timestamp":"2026-10-30T12:00:01Z"}),
        );
        merge_native(&mut local, &native);
        assert_eq!(local.context_usage.as_ref().unwrap().input, None);
        native.context_usage.as_mut().unwrap().observed_at = Some("2026-10-30T12:00:02Z".into());
        merge_native(&mut local, &native);
        assert_eq!(local.context_usage.as_ref().unwrap().input, Some(1000));
        observe(
            &mut local,
            &json!({"type":"turn_context","payload":{"model":"different"}}),
        );
        assert!(local.context_usage.is_none());
        merge_native(&mut local, &native);
        assert!(local.context_usage.is_none());
    }
}
