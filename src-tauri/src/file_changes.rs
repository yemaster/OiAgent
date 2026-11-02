//! Rebuildable offset index: historical diffs reference immutable log evidence,
//! never today's working tree. No file bodies are copied into the index.
use crate::{models::Message, store::AppState};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::File,
    io::{BufRead, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;
const LINE_LIMIT: u64 = 8 * 1024 * 1024;
const PAGE_BYTES: usize = 2 * 1024 * 1024;
const PAGE_SIZE: usize = 30;
static INDEX_LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Default, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
struct Record {
    offset: u64,
    len: u64,
    item: usize,
}
#[derive(Default, Serialize, Deserialize)]
struct Entry {
    first: Record,
    latest: Record,
    input: Option<Record>,
    output: Option<Record>,
    evidence: Option<Record>,
    edit: bool,
}
#[derive(Default, Serialize, Deserialize)]
struct Index {
    schema: u8,
    source: String,
    offset: u64,
    len: u64,
    modified: u128,
    boundary: Vec<u8>,
    head: Vec<u8>,
    omitted: bool,
    entries: BTreeMap<String, Entry>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    messages: Vec<Message>,
    total: usize,
    next: Option<usize>,
    omitted: bool,
}
pub(crate) fn index_path(state: &AppState, id: &str) -> PathBuf {
    state
        .dir
        .join("logs")
        .join(format!("changes-{:x}.json", Sha256::digest(id.as_bytes())))
}
fn decode(line: &[u8], native: bool, subagent: bool) -> Vec<Message> {
    if !native {
        return serde_json::from_slice(line).ok().into_iter().collect();
    }
    let Ok(value) = serde_json::from_slice::<Value>(line) else {
        return vec![];
    };
    if value["isSidechain"] == true && !subagent {
        return vec![];
    }
    crate::transcript::messages(&value, &crate::history::string(&value, "timestamp"))
}
fn edit_name(name: &str) -> bool {
    let name = name.to_lowercase();
    [
        "apply_patch",
        "file_change",
        "write",
        "edit",
        "replace",
        "delete_file",
        "remove_file",
        "create_file",
        "move_file",
        "rename_file",
    ]
    .iter()
    .any(|part| name.contains(part))
}
fn update(path: &Path, cache: &Path, native: bool) -> Result<Index, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    let len = meta.len();
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|t| t.as_nanos())
        .unwrap_or(0);
    let source = format!("{}:{native}", path.display());
    let mut index: Index = File::open(cache)
        .ok()
        .and_then(|f| serde_json::from_reader(BufReader::new(f)).ok())
        .unwrap_or_default();
    let mut head = vec![0; len.min(256) as usize];
    file.read_exact(&mut head).map_err(|e| e.to_string())?;
    let mut boundary = vec![0; index.boundary.len()];
    if len >= index.offset {
        file.seek(SeekFrom::Start(
            index.offset.saturating_sub(boundary.len() as u64),
        ))
        .map_err(|e| e.to_string())?;
        file.read_exact(&mut boundary).map_err(|e| e.to_string())?;
    }
    let rebuild = index.schema != 1
        || index.source != source
        || len < index.len
        || !head.starts_with(&index.head)
        || boundary != index.boundary
        || (len == index.len && modified != index.modified);
    if rebuild {
        index = Index {
            schema: 1,
            source,
            ..Default::default()
        };
    }
    let old_offset = index.offset;
    let subagent = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .starts_with("agent-")
        || path.components().any(|c| c.as_os_str() == "subagents");
    file.seek(SeekFrom::Start(index.offset))
        .map_err(|e| e.to_string())?;
    let mut reader = BufReader::new(file.take(len - index.offset));
    loop {
        let mut line = Vec::new();
        let n = reader
            .by_ref()
            .take(LINE_LIMIT)
            .read_until(b'\n', &mut line)
            .map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        if line.last() != Some(&b'\n') {
            // Leave partial writes for the next read; skip oversized complete records without allocating them.
            if n as u64 == LINE_LIMIT {
                let mut remaining = 0;
                let complete = loop {
                    let buffer = reader.fill_buf().map_err(|e| e.to_string())?;
                    if buffer.is_empty() {
                        break false;
                    }
                    let end = buffer.iter().position(|b| *b == b'\n');
                    let used = end.map_or(buffer.len(), |i| i + 1);
                    reader.consume(used);
                    remaining += used;
                    if end.is_some() {
                        break true;
                    }
                };
                if complete {
                    index.offset += n as u64 + remaining as u64;
                    index.omitted = true;
                    continue;
                }
            }
            break;
        }
        for (item, message) in decode(&line, native, subagent).into_iter().enumerate() {
            let Some(tool) = message.tool else { continue };
            let call = tool["callId"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(String::from)
                .unwrap_or_else(|| format!("offset-{}-{item}", index.offset));
            let parent = message
                .parent_call_id
                .as_deref()
                .or(tool["parentCallId"].as_str())
                .unwrap_or("");
            let key =
                serde_json::to_string(&(message.agent_kind.as_deref().unwrap_or(""), parent, call))
                    .unwrap();
            if !edit_name(tool["name"].as_str().unwrap_or("")) && !index.entries.contains_key(&key)
            {
                continue;
            }
            let record = Record {
                offset: index.offset,
                len: n as u64,
                item,
            };
            let entry = index.entries.entry(key).or_insert_with(|| Entry {
                first: record.clone(),
                ..Default::default()
            });
            entry.latest = record.clone();
            entry.edit |= edit_name(tool["name"].as_str().unwrap_or(""));
            if !tool["input"].is_null() {
                entry.input = Some(record.clone());
            }
            if !tool["output"].is_null() {
                entry.output = Some(record.clone());
            }
            if !tool["fileResult"].is_null() {
                entry.evidence = Some(record);
            }
        }
        index.offset += n as u64;
    }
    index.len = len;
    index.modified = modified;
    index.head = head;
    if rebuild || index.offset != old_offset || !cache.exists() {
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        index.boundary = vec![0; index.offset.min(256) as usize];
        file.seek(SeekFrom::Start(index.offset - index.boundary.len() as u64))
            .map_err(|e| e.to_string())?;
        file.read_exact(&mut index.boundary)
            .map_err(|e| e.to_string())?;
        let mut temp = tempfile::NamedTempFile::new_in(cache.parent().ok_or("缺少索引目录")?)
            .map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut temp, &index).map_err(|e| e.to_string())?;
        temp.flush().map_err(|e| e.to_string())?;
        temp.persist(cache).map_err(|e| e.to_string())?;
    }
    Ok(index)
}
fn page(path: &Path, cache: &Path, native: bool, before: Option<usize>) -> Result<Page, String> {
    let _guard = INDEX_LOCK.lock().map_err(|e| e.to_string())?;
    let index = update(path, cache, native)?;
    let mut entries: Vec<_> = index.entries.iter().filter(|(_, e)| e.edit).collect();
    entries.sort_by_key(|(_, e)| (e.first.offset, e.first.item));
    let total = entries.len();
    let end = before.unwrap_or(total).min(total);
    let mut start = end;
    let mut messages = Vec::new();
    let mut bytes = 0;
    let mut omitted = index.omitted;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    while start > 0 && end - start < PAGE_SIZE {
        let (key, entry) = entries[start - 1];
        let refs: BTreeSet<_> = [
            Some(&entry.first),
            Some(&entry.latest),
            entry.input.as_ref(),
            entry.output.as_ref(),
            entry.evidence.as_ref(),
        ]
        .into_iter()
        .flatten()
        .collect();
        let size: usize = refs.iter().map(|r| r.len as usize).sum();
        if bytes + size > PAGE_BYTES && start < end {
            break;
        }
        start -= 1;
        if size > PAGE_BYTES {
            omitted = true;
            continue;
        }
        let mut rows = Vec::new();
        for r in refs {
            file.seek(SeekFrom::Start(r.offset))
                .map_err(|e| e.to_string())?;
            let mut line = vec![0; r.len as usize];
            file.read_exact(&mut line).map_err(|e| e.to_string())?;
            // These offsets were already filtered by the index. Keep child tool evidence as independent entries.
            if let Some(mut message) = decode(&line, native, true).into_iter().nth(r.item) {
                message.parent_call_id = None;
                if let Some(tool) = message.tool.as_mut() {
                    tool["callId"] = Value::String(key.clone());
                    tool["parentCallId"] = Value::Null;
                }
                rows.push(message);
            }
        }
        bytes += size;
        rows.extend(messages);
        messages = rows;
    }
    Ok(Page {
        messages,
        total,
        next: (start > 0).then_some(start),
        omitted,
    })
}
#[tauri::command]
pub(crate) async fn task_changes(
    app: tauri::AppHandle,
    id: String,
    before: Option<usize>,
) -> Result<Page, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let db = state.db.lock().map_err(|e| e.to_string())?;
        if db.deleted_tasks.contains(&id) {
            return Err("记录已删除".into());
        }
        let task = db.tasks.iter().find(|t| t.id == id).cloned();
        drop(db);
        let task = task
            .or_else(|| {
                state
                    .history
                    .lock()
                    .unwrap()
                    .scan()
                    .0
                    .into_iter()
                    .find(|t| t.id == id)
            })
            .ok_or("会话不存在")?;
        let managed = state
            .dir
            .join("logs")
            .join(format!("{}.messages.jsonl", task.id));
        let cache = index_path(&state, &id);
        let managed_page = if managed.exists() {
            let result = page(&managed, &cache, false, before)?;
            if result.total > 0 || result.omitted {
                return Ok(result);
            }
            Some(result)
        } else {
            None
        };
        let native = task.history_path.or_else(|| {
            task.session_id
                .as_ref()
                .and_then(|sid| {
                    state
                        .history
                        .lock()
                        .unwrap()
                        .find_session(&task.agent_kind, sid)
                })
                .and_then(|t| t.history_path)
        });
        if let Some(path) = native {
            return page(
                Path::new(&path),
                &cache.with_extension("native.json"),
                true,
                before,
            );
        }
        Ok(managed_page.unwrap_or(Page {
            messages: vec![],
            total: 0,
            next: None,
            omitted: false,
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;
    fn event(id: &str, name: &str, input: Value, output: Value, parent: &str) -> String {
        json!({"role":"tool","text":"","timestamp":"now","tool":{"callId":id,"name":name,"input":input,"output":output,"state":if output.is_null() {"called"} else {"completed"},"parentCallId":parent}}).to_string() + "\n"
    }
    #[test]
    fn pages_early_edits_pairs_results_and_stores_only_offsets() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("messages.jsonl");
        let cache = dir.path().join("index.json");
        let mut file = File::create(&path).unwrap();
        for i in 0..65 {
            file.write_all(event(&i.to_string(), "Edit", json!({"file_path":"a.ts","old_string":"SENSITIVE_BODY", "new_string":i.to_string()}), Value::Null, "").as_bytes()).unwrap();
        }
        // Results can arrive much later and out of order, after thousands of non-edit records.
        for _ in 0..1000 {
            writeln!(
                file,
                "{}",
                json!({"role":"assistant","text":"output","timestamp":""})
            )
            .unwrap();
        }
        file.write_all(event("0", "", Value::Null, json!("done"), "").as_bytes())
            .unwrap();
        let latest = page(&path, &cache, false, None).unwrap();
        assert_eq!(latest.total, 65);
        assert_eq!(latest.next, Some(35));
        assert_eq!(latest.messages.len(), 30);
        let middle = page(&path, &cache, false, latest.next).unwrap();
        let first = page(&path, &cache, false, middle.next).unwrap();
        assert_eq!(first.next, None);
        assert_eq!(first.messages.len(), 6);
        assert_eq!(
            first.messages[0].tool.as_ref().unwrap()["input"]["old_string"],
            "SENSITIVE_BODY"
        );
        assert_eq!(first.messages[1].tool.as_ref().unwrap()["output"], "done");
        assert!(!fs::read_to_string(&cache)
            .unwrap()
            .contains("SENSITIVE_BODY"));
        // No frontend conversation payload or current working file is needed to reopen the archive.
        assert_eq!(page(&path, &cache, false, None).unwrap().total, 65);
    }
    #[test]
    fn incremental_partial_records_replacements_and_parent_ids() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("messages.jsonl");
        let cache = dir.path().join("index.json");
        let mut file = File::create(&path).unwrap();
        file.write_all(
            event(
                "same",
                "Edit",
                json!({"file_path":"a"}),
                Value::Null,
                "parent-a",
            )
            .as_bytes(),
        )
        .unwrap();
        let next = event(
            "same",
            "Edit",
            json!({"file_path":"b"}),
            Value::Null,
            "parent-b",
        );
        file.write_all(next.trim_end().as_bytes()).unwrap();
        assert_eq!(page(&path, &cache, false, None).unwrap().total, 1);
        file.write_all(b"\n").unwrap();
        let both = page(&path, &cache, false, None).unwrap();
        assert_eq!(both.total, 2);
        assert_ne!(
            both.messages[0].tool.as_ref().unwrap()["callId"],
            both.messages[1].tool.as_ref().unwrap()["callId"]
        );
        drop(file);
        fs::write(
            &path,
            event(
                "replacement",
                "Write",
                json!({"file_path":"new"}),
                Value::Null,
                "",
            ),
        )
        .unwrap();
        assert_eq!(page(&path, &cache, false, None).unwrap().total, 1);
        fs::write(&cache, "corrupt").unwrap();
        assert_eq!(page(&path, &cache, false, None).unwrap().total, 1);
    }
    #[test]
    fn native_events_preserve_file_evidence_and_oversized_partial_lines_retry() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("native.jsonl");
        let cache = dir.path().join("index.json");
        fs::write(&path, json!({"type":"response_item", "payload":{"type":"function_call", "call_id":"edit", "name":"apply_patch", "arguments":"*** Begin Patch\n*** Add File: a.ts\n+hello\n*** End Patch"}}).to_string() + "\n").unwrap();
        let native = page(&path, &cache, true, None).unwrap();
        assert_eq!(native.total, 1);
        assert!(native.messages[0].tool.as_ref().unwrap()["input"]
            .as_str()
            .unwrap()
            .contains("hello"));
        let mut file = File::create(&path).unwrap();
        file.write_all(&vec![b'x'; LINE_LIMIT as usize + 100])
            .unwrap();
        assert_eq!(update(&path, &cache, false).unwrap().offset, 0);
        file.write_all(b"\n").unwrap();
        file.write_all(
            event("latest", "Edit", json!({"file_path":"b"}), Value::Null, "").as_bytes(),
        )
        .unwrap();
        let result = page(&path, &cache, false, None).unwrap();
        assert!(result.omitted);
        assert_eq!(result.total, 1);
    }
    #[test]
    fn bounds_payload_and_ignores_read_tools() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("messages.jsonl");
        let cache = dir.path().join("index.json");
        let mut file = File::create(&path).unwrap();
        for i in 0..20 {
            file.write_all(
                event(
                    &i.to_string(),
                    "Write",
                    json!({"file_path":"a","content":"x".repeat(180000)}),
                    Value::Null,
                    "",
                )
                .as_bytes(),
            )
            .unwrap();
        }
        file.write_all(
            event(
                "read",
                "Read",
                json!({"file_path":"a"}),
                json!("contents"),
                "",
            )
            .as_bytes(),
        )
        .unwrap();
        let first = page(&path, &cache, false, None).unwrap();
        assert_eq!(first.total, 20);
        assert!(first.next.is_some());
        assert!(serde_json::to_vec(&first.messages).unwrap().len() < PAGE_BYTES);
    }
}
