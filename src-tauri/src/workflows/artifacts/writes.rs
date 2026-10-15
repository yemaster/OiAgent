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
        "filepath",
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
        .rsplit(['.', ':'])
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let input = decoded(&tool["input"]);
    let mut result = Vec::new();
    match name.as_str() {
        "write" | "write_file" | "create_file" | "edit" | "edit_file" | "multiedit" | "replace"
        | "str_replace_editor" | "str_replace" | "replace_in_file" | "writefile" | "editfile"
        | "createfile" => {
            if input["command"] == "view" || input["command"] == "undo_edit" {
                return result;
            }
            // A successful no-op replacement does not produce an artifact.
            let changed = |edit: &Value| {
                edit.get("old_string")
                    .zip(edit.get("new_string"))
                    .or_else(|| edit.get("old_str").zip(edit.get("new_str")))
                    .or_else(|| edit.get("old_text").zip(edit.get("new_text")))
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
                .or(input["patchText"].as_str())
                .or(input["patch_text"].as_str())
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

#[derive(Default)]
struct Write {
    paths: Vec<String>,
    state: String,
    failed: bool,
}

/// Retain identities and filenames, not file contents or command output.
#[derive(Default)]
pub(super) struct Index {
    calls: Vec<Write>,
    indices: HashMap<(Option<String>, Option<String>, String), usize>,
}
impl Index {
    pub(super) fn ingest(&mut self, message: &Message) {
        let Some(tool) = &message.tool else {
            return;
        };
        let index = if let Some(id) = tool["callId"].as_str().filter(|id| !id.is_empty()) {
            let key = (
                message.agent_kind.clone(),
                message
                    .parent_call_id
                    .clone()
                    .or_else(|| tool["parentCallId"].as_str().map(String::from)),
                id.to_owned(),
            );
            *self.indices.entry(key).or_insert_with(|| {
                self.calls.push(Write::default());
                self.calls.len() - 1
            })
        } else {
            self.calls.push(Write::default());
            self.calls.len() - 1
        };
        let entry = &mut self.calls[index];
        if tool["name"].as_str().is_some_and(|name| !name.is_empty()) && !tool["input"].is_null() {
            entry.paths = paths(tool);
        }
        if let Some(state) = tool["state"].as_str() {
            entry.state = state.into();
        }
        if !tool["output"].is_null() {
            let output = decoded(&tool["output"]);
            entry.failed = output["is_error"] == true
                || output["isError"] == true
                || output.get("error").is_some_and(|v| !v.is_null())
                || output["exit_code"].as_i64().is_some_and(|code| code != 0)
                || output
                    .as_str()
                    .is_some_and(|text| text.trim_start().starts_with("Error:"));
        }
    }
    pub(super) fn paths(&self) -> Vec<String> {
        self.calls
            .iter()
            .filter(|entry| entry.state == "completed" && !entry.failed)
            .flat_map(|entry| entry.paths.iter().cloned())
            .collect()
    }
}
pub(super) fn successful_paths(messages: &[Message]) -> Vec<String> {
    let mut index = Index::default();
    for message in messages {
        index.ingest(message);
    }
    index.paths()
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
    fn native_replay_results_and_patch_text_report_mutations_without_prose() {
        let mut messages = crate::transcript::messages(
            &json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"w","name":"Write","input":{"file_path":"created.md","content":"hello"}}]}}),
            "now",
        );
        messages.extend(crate::transcript::messages(&json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"w","content":"written"}]}}), "later"));
        assert_eq!(successful_paths(&messages), ["created.md"]);
        assert_eq!(
            paths(
                &json!({"name":"apply_patch", "input":{"patchText":"*** Begin Patch\n*** Add File: output.md\n+hello\n*** End Patch"}})
            ),
            ["output.md"]
        );
    }
    #[test]
    fn patch_tracks_destinations_not_deleted_files_or_references_in_content() {
        let tool = json!({"name":"functions.apply_patch","input":"*** Begin Patch\n*** Update File: old.md\n*** Move to: new.md\n@@\n-old\n+read reference.md\n*** Delete File: removed.md\n*** Add File: Dockerfile\n+FROM example\n*** End Patch"});
        assert_eq!(paths(&tool), vec!["new.md", "Dockerfile"]);
        assert!(paths(&json!({"name":"apply_patch","input":"*** Begin Patch\n*** Update File: unchanged.md\n@@\n context only\n*** End Patch"})).is_empty());
    }
}
