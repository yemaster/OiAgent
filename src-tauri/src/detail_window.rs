//! Bounded UI snapshots. Disk records remain untouched for authoritative edits.
use crate::models::Message;
use std::{
    collections::VecDeque,
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::Path,
};

pub(crate) const MAX_BYTES: u64 = 2 * 1024 * 1024;
pub(crate) const MAX_MESSAGES: usize = 500;

pub(crate) fn read(path: &Path, native: Option<&str>) -> (Vec<Message>, bool) {
    let Ok(mut file) = File::open(path) else {
        return (vec![], false);
    };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let offset = len.saturating_sub(MAX_BYTES);
    // Include the preceding byte so a record exactly on the boundary survives.
    let start = offset.saturating_sub(1);
    if file.seek(SeekFrom::Start(start)).is_err() {
        return (vec![], false);
    }
    let mut bytes = Vec::new();
    if file.take(len - start).read_to_end(&mut bytes).is_err() {
        return (vec![], false);
    }
    let mut truncated = offset > 0;
    let contents = if offset > 0 {
        match bytes.iter().position(|b| *b == b'\n') {
            Some(i) => &bytes[i + 1..],
            None => return (vec![], true),
        }
    } else {
        &bytes[..]
    };
    let subagent_file = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .starts_with("agent-")
        || path.components().any(|c| c.as_os_str() == "subagents");
    let mut messages: VecDeque<Message> = VecDeque::new();
    for line in contents.split_inclusive(|b| *b == b'\n') {
        // A writer may still be in the middle of a managed record.
        if native.is_none() && line.last() != Some(&b'\n') {
            break;
        }
        let rows = if native.is_some() {
            serde_json::from_slice::<serde_json::Value>(line)
                .ok()
                .filter(|v| subagent_file || v["isSidechain"] != true)
                .map(|v| crate::transcript::messages(&v, &crate::history::string(&v, "timestamp")))
                .unwrap_or_default()
        } else {
            serde_json::from_slice::<Message>(line)
                .ok()
                .into_iter()
                .collect()
        };
        for row in rows {
            // A thinking stream is one visible record, not hundreds of records
            // that evict its beginning (and the user's prompt) from the window.
            if let Some(previous) = messages.back_mut().filter(|previous| {
                row.reasoning.as_ref().is_some_and(|timing| {
                    previous
                        .reasoning
                        .as_ref()
                        .is_some_and(|old| old.id == timing.id)
                }) && previous.parent_call_id == row.parent_call_id
            }) {
                if row.delta {
                    previous.text.push_str(&row.text);
                } else {
                    previous.text = row.text;
                }
                previous.reasoning = row.reasoning;
                if row.native_id.is_some() {
                    previous.native_id = row.native_id;
                }
                continue;
            }
            messages.push_back(row);
            if messages.len() > MAX_MESSAGES {
                messages.pop_front();
                truncated = true;
            }
        }
    }
    (messages.into_iter().collect(), truncated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn line(text: &str) -> String {
        serde_json::json!({"role":"assistant", "text":text, "timestamp":""}).to_string() + "\n"
    }
    #[test]
    fn bounds_many_messages_and_preserves_disk_history() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        for i in 0..10000 {
            file.write_all(line(&i.to_string()).as_bytes()).unwrap();
        }
        let size = file.as_file().metadata().unwrap().len();
        let (rows, truncated) = read(file.path(), None);
        assert!(truncated);
        assert_eq!(rows.len(), MAX_MESSAGES);
        assert_eq!(rows[0].text, "9500");
        assert_eq!(rows.last().unwrap().text, "9999");
        assert_eq!(file.as_file().metadata().unwrap().len(), size);
    }
    #[test]
    fn streamed_thinking_keeps_its_first_lines_and_does_not_evict_other_messages() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(line("previous reply").as_bytes()).unwrap();
        for i in 0..700 {
            let row = serde_json::json!({"role":"reasoning","text":format!("line {i}\n"),"timestamp":"start","delta":i>0,"reasoning":{"id":"r","startedAt":"start","completedAt":null,"completed":false}});
            writeln!(file, "{row}").unwrap();
        }
        let (rows, truncated) = read(file.path(), None);
        assert!(!truncated);
        assert_eq!(rows.len(), 2);
        assert!(rows[1].text.starts_with("line 0\nline 1\n"));
        assert!(rows[1].text.ends_with("line 698\nline 699\n"));
    }
    #[test]
    fn bounds_giant_records_and_handles_utf8_and_partial_appends() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(line(&"中".repeat(MAX_BYTES as usize)).as_bytes())
            .unwrap();
        file.write_all(line("最新消息").as_bytes()).unwrap();
        let partial = line("后续消息");
        file.write_all(partial.trim_end().as_bytes()).unwrap();
        let (rows, truncated) = read(file.path(), None);
        assert!(truncated);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].text, "最新消息");
        file.write_all(b"\n").unwrap();
        assert_eq!(read(file.path(), None).0.last().unwrap().text, "后续消息");
    }
    #[test]
    fn native_tail_filters_sidechains_and_keeps_subagent_files() {
        let dir = tempfile::tempdir().unwrap();
        let text = serde_json::json!({"type":"assistant", "isSidechain":true,
            "message":{"content":[{"type":"text", "text":"child"}]}})
        .to_string();
        let parent = dir.path().join("session.jsonl");
        let child = dir.path().join("agent-child.jsonl");
        std::fs::write(&parent, &text).unwrap();
        std::fs::write(&child, &text).unwrap();
        assert!(read(&parent, Some("claude")).0.is_empty());
        assert_eq!(read(&child, Some("claude")).0[0].text, "child");
    }
    #[test]
    fn preserves_record_at_exact_byte_boundary() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"discard\n").unwrap();
        let overhead = line("").len();
        file.write_all(line(&"x".repeat(MAX_BYTES as usize - overhead)).as_bytes())
            .unwrap();
        let (rows, truncated) = read(file.path(), None);
        assert!(truncated);
        assert_eq!(rows.len(), 1);
    }
}
