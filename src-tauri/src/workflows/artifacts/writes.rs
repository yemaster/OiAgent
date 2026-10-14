//! File mutation evidence from normalized tool events, never from read/search inputs.
use crate::models::Message;
use serde_json::Value;
use std::collections::HashMap;

fn decoded(value: &Value) -> Value {
    value
        .as_str()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_else(|| value.clone())
}

fn path(value: &Value) -> Option<&str> {
    [
        "file_path",
        "filePath",
        "path",
        "absolute_path",
        "target_file",
    ]
    .iter()
    .find_map(|key| value[*key].as_str())
}

fn paths(tool: &Value) -> Vec<String> {
    let name = tool["name"]
        .as_str()
        .unwrap_or("")
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let input = decoded(&tool["input"]);
    let mut result = Vec::new();
    match name.as_str() {
        "write" | "write_file" | "create_file" | "edit" | "edit_file" | "multiedit" | "replace"
        | "str_replace_editor" => {
            if input["command"] == "view" || input["command"] == "undo_edit" {
                return result;
            }
            // A successful no-op replacement does not produce an artifact.
            let changed = |edit: &Value| {
                edit.get("old_string")
                    .zip(edit.get("new_string"))
                    .or_else(|| edit.get("old_str").zip(edit.get("new_str")))
                    .is_none_or(|(old, new)| old != new)
            };
            let changed = input["edits"]
                .as_array()
                .map_or_else(|| changed(&input), |edits| edits.iter().any(changed));
            if changed {
                if let Some(path) = path(&input) {
                    result.push(path.into());
                }
            }
        }
        "file_change" => {
            if let Some(changes) = input["changes"].as_array() {
                for change in changes {
                    let kind = change["kind"]["type"]
                        .as_str()
                        .or(change["kind"].as_str())
                        .unwrap_or("");
                    if !["add", "update", "edit", "create", "rename"].contains(&kind) {
                        continue;
                    }
                    if let Some(path) = change["kind"]["move_path"]
                        .as_str()
                        .or(change["move_path"].as_str())
                        .or_else(|| path(change))
                    {
                        result.push(path.into());
                    }
                }
            }
        }
        "apply_patch" => {
            let patch = input
                .as_str()
                .or(input["patch"].as_str())
                .or(input["input"].as_str())
                .unwrap_or("");
            let mut current: Option<String> = None;
            let mut changed = false;
            for line in patch.lines().chain(std::iter::once("*** End Patch")) {
                if line.starts_with("*** ") && !line.starts_with("*** Move to: ") {
                    if changed {
                        if let Some(path) = current.take() {
                            result.push(path);
                        }
                    }
                    current = line
                        .strip_prefix("*** Add File: ")
                        .or_else(|| line.strip_prefix("*** Update File: "))
                        .map(str::to_owned);
                    changed = line.starts_with("*** Add File: ");
                } else if let Some(destination) = line.strip_prefix("*** Move to: ") {
                    if current.is_some() {
                        current = Some(destination.into());
                        changed = true;
                    }
                } else if line.starts_with(['+', '-']) {
                    changed = true;
                }
            }
        }
        _ => {}
    }
    result
}

pub(super) fn successful_paths(messages: &[Message]) -> Vec<String> {
    let mut calls: Vec<Value> = Vec::new();
    let mut indices = HashMap::new();
    for message in messages {
        let Some(tool) = &message.tool else {
            continue;
        };
        let id = tool["callId"].as_str().filter(|id| !id.is_empty());
        let index = id
            .map(|id| {
                let key = (
                    message.agent_kind.clone(),
                    message.parent_call_id.clone(),
                    id.to_owned(),
                );
                *indices.entry(key).or_insert_with(|| {
                    calls.push(Value::Object(Default::default()));
                    calls.len() - 1
                })
            })
            .unwrap_or_else(|| {
                calls.push(Value::Object(Default::default()));
                calls.len() - 1
            });
        for field in ["name", "input", "output", "state"] {
            if let Some(value) = tool
                .get(field)
                .filter(|v| !v.is_null() && v.as_str() != Some(""))
            {
                calls[index][field] = value.clone();
            }
        }
    }
    calls
        .iter()
        .filter(|tool| {
            let output = decoded(&tool["output"]);
            tool["state"] == "completed"
                && output["is_error"] != true
                && output["isError"] != true
                && output.get("error").is_none_or(Value::is_null)
                && !output["exit_code"].as_i64().is_some_and(|code| code != 0)
                && !output
                    .as_str()
                    .is_some_and(|text| text.trim_start().starts_with("Error:"))
        })
        .flat_map(paths)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merges_results_and_excludes_reads_failed_pending_and_noop_edits() {
        let events = vec![
            json!({"callId":"write","name":"Write","input":{"file_path":"report.md"},"state":"called"}),
            json!({"callId":"read","name":"Read","input":{"file_path":"reference.md"},"state":"completed"}),
            json!({"callId":"failed","name":"Edit","input":{"file_path":"failed.md"},"state":"called"}),
            json!({"callId":"failed","state":"failed"}),
            json!({"callId":"pending","name":"Write","input":{"file_path":"pending.md"},"state":"called"}),
            json!({"callId":"write","name":"","input":null,"state":"completed","output":"ok"}),
            json!({"name":"Edit","input":{"file_path":"noop.md","old_string":"same","new_string":"same"},"state":"completed"}),
            json!({"name":"Write","input":{"file_path":"error.md"},"state":"completed","output":{"isError":true}}),
            json!({"name":"file_change","input":{"changes":[{"path":"deleted.md","kind":"delete"},{"path":"code.rs","kind":"update"},{"path":"old.md","kind":{"type":"update","move_path":"renamed.md"}}]},"state":"completed"}),
        ];
        let messages: Vec<Message> = events
            .into_iter()
            .map(|tool| {
                serde_json::from_value(json!({"role":"tool","text":"","timestamp":"","tool":tool}))
                    .unwrap()
            })
            .collect();
        assert_eq!(
            successful_paths(&messages),
            vec!["report.md", "code.rs", "renamed.md"]
        );
    }

    #[test]
    fn patch_tracks_destinations_not_deleted_files_or_references_in_content() {
        let tool = json!({"name":"functions.apply_patch","input":"*** Begin Patch\n*** Update File: old.md\n*** Move to: new.md\n@@\n-old\n+read reference.md\n*** Delete File: removed.md\n*** Add File: Dockerfile\n+FROM example\n*** End Patch"});
        assert_eq!(paths(&tool), vec!["new.md", "Dockerfile"]);
        assert!(paths(&json!({"name":"apply_patch","input":"*** Begin Patch\n*** Update File: unchanged.md\n@@\n context only\n*** End Patch"})).is_empty());
    }
}
