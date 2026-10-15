//! Incremental mutation index with a bounded tail for prose/reference evidence.
use super::writes;
use crate::models::Message;
use std::{
    collections::{HashMap, VecDeque},
    fs::File,
    io::{self, BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Instant, SystemTime},
};
const TAIL_BYTES: usize = 512 * 1024;

#[derive(Default)]
struct Entry {
    offset: u64,
    len: u64,
    modified: Option<SystemTime>,
    boundary: Vec<u8>,
    writes: writes::Index,
    recent: VecDeque<(usize, Message)>,
    bytes: usize,
}
#[derive(Default)]
pub(crate) struct LogCache {
    entries: HashMap<PathBuf, (Instant, Entry)>,
}
pub(super) struct Summary {
    pub messages: Vec<Message>,
    pub written: Vec<String>,
}
impl LogCache {
    pub(super) fn read(&mut self, path: &Path) -> io::Result<Summary> {
        let mut file = File::open(path)?;
        let metadata = file.metadata()?;
        let len = metadata.len();
        let modified = metadata.modified().ok();
        if !self.entries.contains_key(path) && self.entries.len() >= 16 {
            if let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (time, _))| time)
                .map(|(key, _)| key.clone())
            {
                self.entries.remove(&oldest);
            }
        }
        let (used, entry) = self
            .entries
            .entry(path.into())
            .or_insert_with(|| (Instant::now(), Entry::default()));
        *used = Instant::now();
        // Detect truncation/replacement, including a replacement longer than the old log.
        let mut boundary = vec![0; entry.boundary.len()];
        if len >= entry.offset {
            file.seek(SeekFrom::Start(
                entry.offset.saturating_sub(boundary.len() as u64),
            ))?;
            file.read_exact(&mut boundary)?;
        }
        if len < entry.offset
            || boundary != entry.boundary
            || (len == entry.len && modified != entry.modified)
        {
            *entry = Entry::default();
        }
        file.seek(SeekFrom::Start(entry.offset))?;
        let mut reader = BufReader::new(file.take(len.saturating_sub(entry.offset)));
        let mut line = Vec::new();
        loop {
            line.clear();
            let count = reader.read_until(b'\n', &mut line)?;
            if count == 0 || line.last() != Some(&b'\n') {
                break;
            }
            entry.offset += count as u64;
            if let Ok(message) = serde_json::from_slice::<Message>(&line) {
                entry.writes.ingest(&message);
                if count <= TAIL_BYTES {
                    entry.bytes += count;
                    entry.recent.push_back((count, message));
                    while entry.bytes > TAIL_BYTES {
                        if let Some((size, _)) = entry.recent.pop_front() {
                            entry.bytes -= size;
                        }
                    }
                }
            }
            entry.boundary = line[line.len().saturating_sub(256)..].to_vec();
        }
        entry.len = len;
        entry.modified = modified;
        Ok(Summary {
            messages: entry
                .recent
                .iter()
                .map(|(_, message)| message.clone())
                .collect(),
            written: entry.writes.paths(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, io::Write};
    #[test]
    fn retains_early_calls_across_long_logs_and_reads_only_complete_appends() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("messages.jsonl");
        let event = |tool| {
            serde_json::json!({"role":"tool","text":"","timestamp":"","tool":tool}).to_string()
                + "\n"
        };
        let mut file = File::create(&path).unwrap();
        file.write_all(event(serde_json::json!({"callId":"w","name":"Write","state":"called","input":{"file_path":"first.md"}})).as_bytes()).unwrap();
        for _ in 0..12 {
            writeln!(
                file,
                "{}",
                serde_json::json!({"role":"assistant","text":"x".repeat(50000),"timestamp":""})
            )
            .unwrap();
        }
        let mut cache = LogCache::default();
        assert!(cache.read(&path).unwrap().written.is_empty());
        let done = event(serde_json::json!({"callId":"w","state":"completed"}));
        file.write_all(done.trim_end().as_bytes()).unwrap();
        assert!(cache.read(&path).unwrap().written.is_empty());
        file.write_all(b"\n").unwrap();
        assert_eq!(cache.read(&path).unwrap().written, ["first.md"]);
        assert_eq!(cache.read(&path).unwrap().written, ["first.md"]);
        drop(file);
        fs::write(&path, event(serde_json::json!({"name":"Write","state":"completed","input":{"file_path":"replacement.md"}}))).unwrap();
        assert_eq!(cache.read(&path).unwrap().written, ["replacement.md"]);
    }
}
