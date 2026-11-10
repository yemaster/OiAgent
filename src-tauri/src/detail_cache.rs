//! Cache only bounded, managed transcript tails. Native histories keep their own reader.
use crate::{
    detail_window::{Window, MAX_BYTES},
    models::Message,
};
use std::{
    collections::HashMap,
    fs::{File, Metadata},
    io::{self, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::{Instant, SystemTime},
};

#[derive(Default)]
struct Entry {
    window: Window,
    offset: u64,
    len: u64,
    modified: Option<SystemTime>,
    identity: (u64, u64, Option<SystemTime>),
    boundary: Vec<u8>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn row(text: &str, id: &str, delta: bool) -> String {
        serde_json::json!({"role":"assistant","text":text,"timestamp":"t","streamId":id,"delta":delta}).to_string() + "\n"
    }
    #[test]
    fn incremental_reads_join_interleaved_streams_and_ignore_incomplete_records() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        let mut cache = Cache::default();
        file.write_all(row("first", "a", false).as_bytes()).unwrap();
        assert_eq!(cache.read(file.path()).0[0].text, "first");
        for _ in 0..700 {
            file.write_all(row("x", "b", true).as_bytes()).unwrap();
            file.write_all(row("y", "a", true).as_bytes()).unwrap();
        }
        let (messages, truncated) = cache.read(file.path());
        assert!(!truncated);
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].text, format!("first{}", "y".repeat(700)));
        assert_eq!(messages[1].text, "x".repeat(700));
        let offset = cache.entries[file.path()].1.offset;
        let final_row = row("authoritative", "a", false);
        file.write_all(final_row.trim_end().as_bytes()).unwrap();
        assert_eq!(cache.read(file.path()).0[0].text, messages[0].text);
        assert_eq!(cache.entries[file.path()].1.offset, offset);
        file.write_all(b"\n").unwrap();
        assert_eq!(cache.read(file.path()).0[0].text, "authoritative");
        assert_eq!(cache.read(file.path()).0.len(), 2);
        // Replacing a file (even with a longer log) must discard old rows.
        std::fs::write(
            file.path(),
            row(&"new".repeat(100000), "replacement", false),
        )
        .unwrap();
        let replaced = cache.read(file.path()).0;
        assert_eq!(replaced.len(), 1);
        assert_eq!(replaced[0].stream_id.as_deref(), Some("replacement"));
    }
    #[test]
    fn bounds_cached_files_and_rebuilds_large_tails_without_reading_entire_history() {
        let dir = tempfile::tempdir().unwrap();
        let mut cache = Cache::default();
        for i in 0..8 {
            let path = dir.path().join(i.to_string());
            std::fs::write(&path, row("latest", "a", false)).unwrap();
            cache.read(&path);
        }
        assert_eq!(cache.entries.len(), 4);
        let path = dir.path().join("large");
        let mut file = File::create(&path).unwrap();
        file.write_all(row(&"x".repeat(MAX_BYTES as usize + 1), "old", false).as_bytes())
            .unwrap();
        file.write_all(row("latest", "last", false).as_bytes())
            .unwrap();
        let (messages, truncated) = cache.read(&path);
        assert!(truncated);
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].text, "latest");
    }
}
#[derive(Default)]
pub(crate) struct Cache {
    entries: HashMap<PathBuf, (Instant, Entry)>,
}
fn identity(meta: &Metadata) -> (u64, u64, Option<SystemTime>) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        (meta.dev(), meta.ino(), meta.created().ok())
    }
    #[cfg(not(unix))]
    {
        (0, 0, meta.created().ok())
    }
}
impl Cache {
    pub fn read(&mut self, path: &Path) -> (Vec<Message>, bool) {
        match self.update(path) {
            Ok(snapshot) => snapshot,
            Err(_) => {
                self.entries.remove(path);
                crate::detail_window::read(path, None)
            }
        }
    }
    fn update(&mut self, path: &Path) -> io::Result<(Vec<Message>, bool)> {
        let mut file = File::open(path)?;
        let meta = file.metadata()?;
        let len = meta.len();
        let modified = meta.modified().ok();
        let identity = identity(&meta);
        // At most four recent panes, 2 MiB / 500 visible rows each. No timers.
        self.entries
            .retain(|_, (used, _)| used.elapsed().as_secs() < 60);
        if !self.entries.contains_key(path) && self.entries.len() >= 4 {
            if let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, (used, _))| used)
                .map(|(path, _)| path.clone())
            {
                self.entries.remove(&oldest);
            }
        }
        let (used, entry) = self
            .entries
            .entry(path.into())
            .or_insert_with(|| (Instant::now(), Entry::default()));
        *used = Instant::now();
        let mut boundary = vec![0; entry.boundary.len()];
        if len >= entry.offset {
            file.seek(SeekFrom::Start(
                entry.offset.saturating_sub(boundary.len() as u64),
            ))?;
            file.read_exact(&mut boundary)?;
        }
        let reset = entry.identity != identity
            || len < entry.offset
            || boundary != entry.boundary
            || (len == entry.len && modified != entry.modified)
            || len.saturating_sub(entry.offset) > MAX_BYTES;
        if reset {
            *entry = Entry::default();
            entry.offset = len.saturating_sub(MAX_BYTES).saturating_sub(1);
            entry.window.truncated = len > MAX_BYTES;
        }
        file.seek(SeekFrom::Start(entry.offset))?;
        let mut bytes = Vec::new();
        // Snapshot the length so a busy producer cannot hold this read open.
        (&mut file)
            .take(len - entry.offset)
            .read_to_end(&mut bytes)?;
        let skip = if reset && entry.window.truncated {
            bytes
                .iter()
                .position(|b| *b == b'\n')
                .map_or(bytes.len(), |i| i + 1)
        } else {
            0
        };
        entry.offset += skip as u64;
        for line in bytes[skip..].split_inclusive(|b| *b == b'\n') {
            if line.last() != Some(&b'\n') {
                break;
            }
            entry.offset += line.len() as u64;
            if let Ok(row) = serde_json::from_slice::<Message>(line) {
                entry.window.push(row, line.len());
            }
        }
        let guard_len = entry.offset.min(256) as usize;
        entry.boundary.resize(guard_len, 0);
        file.seek(SeekFrom::Start(entry.offset - guard_len as u64))?;
        file.read_exact(&mut entry.boundary)?;
        entry.identity = identity;
        entry.len = len;
        entry.modified = modified;
        Ok(entry.window.snapshot())
    }
}
