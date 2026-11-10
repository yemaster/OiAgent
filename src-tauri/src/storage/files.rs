use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs::{self, File, Metadata},
    io::Write,
    path::{Component, Path, PathBuf},
    time::{Duration, Instant, UNIX_EPOCH},
};

pub const WORK_MARKER: &str = ".oiagent-work";
pub const STALE_WORK: Duration = Duration::from_secs(24 * 60 * 60);

pub fn link(meta: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}

/// Inspect every component below the data root, including missing final paths.
/// A missing leaf is allowed for retryable cleanup; an uninspectable path isn't.
pub fn secure(root: &Path, path: &Path) -> Result<(), String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "路径不属于应用数据目录")?;
    if relative
        .components()
        .any(|p| !matches!(p, Component::Normal(_)))
    {
        return Err("无效存储路径".into());
    }
    let mut current = root.to_path_buf();
    for part in std::iter::once(None).chain(relative.components().map(Some)) {
        if let Some(part) = part {
            current.push(part.as_os_str());
        }
        match fs::symlink_metadata(&current) {
            Ok(meta) if link(&meta) => return Err("路径包含链接，已保护".into()),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(format!("无法检查文件：{e}")),
        }
    }
    Ok(())
}

pub struct Budget {
    start: Instant,
    entries: usize,
}
impl Default for Budget {
    fn default() -> Self {
        Self {
            start: Instant::now(),
            entries: 0,
        }
    }
}
impl Budget {
    fn step(&mut self) -> Result<(), String> {
        self.entries += 1;
        if self.entries > 500_000 || self.start.elapsed() > Duration::from_secs(20) {
            Err("文件较多，本次统计未完成；未完整检查的项目无法删除".into())
        } else {
            Ok(())
        }
    }
}

#[derive(Default)]
pub struct Measure {
    pub bytes: u64,
    pub revision: String,
    pub warning: Option<String>,
}

/// Metadata only: bounded traversal, no file contents, no linked target or mount traversal.
/// The order-independent digest avoids collecting/sorting a huge file list in memory.
pub fn measure(
    root: &Path,
    paths: &[PathBuf],
    excluded: &HashSet<PathBuf>,
    budget: &mut Budget,
) -> Measure {
    let mut result = Measure::default();
    let mut digest = [0u8; 32];
    let mut count = 0u64;
    for path in paths {
        if let Err(e) = secure(root, path) {
            result.warning = Some(e);
            continue;
        }
        if !path.exists() {
            continue;
        }
        #[cfg(unix)]
        let root_device = {
            use std::os::unix::fs::MetadataExt;
            fs::metadata(root).ok().map(|m| m.dev())
        };
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if fs::symlink_metadata(path).is_ok_and(|m| Some(m.dev()) != root_device) {
                result.warning = Some("目录位于其他文件系统，已保护".into());
                continue;
            }
        }
        let entries = walkdir::WalkDir::new(path)
            .follow_links(false)
            .same_file_system(true)
            .max_open(8)
            .into_iter()
            .filter_entry(|entry| !excluded.contains(entry.path()));
        for entry in entries {
            if let Err(e) = budget.step() {
                result.warning = Some(e);
                break;
            }
            let entry = match entry {
                Ok(e) => e,
                Err(e) => {
                    result.warning = Some(format!("部分文件无法读取：{e}"));
                    continue;
                }
            };
            let meta = match fs::symlink_metadata(entry.path()) {
                Ok(m) => m,
                Err(e) => {
                    result.warning = Some(e.to_string());
                    continue;
                }
            };
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                if Some(meta.dev()) != root_device {
                    result.warning = Some("包含其他文件系统的挂载目录，已保护".into());
                    continue;
                }
            }
            if link(&meta) && meta.is_dir() {
                result.warning = Some("包含目录链接，已保护".into());
            }
            if meta.is_file() && !link(&meta) {
                result.bytes = result.bytes.saturating_add(meta.len());
            }
            let mut hash = Sha256::new();
            hash.update(entry.path().as_os_str().as_encoded_bytes());
            hash.update(meta.len().to_le_bytes());
            hash.update([u8::from(meta.is_dir()), u8::from(link(&meta))]);
            for time in [meta.modified(), meta.created()] {
                hash.update(
                    time.ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .unwrap_or_default()
                        .as_nanos()
                        .to_le_bytes(),
                );
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                hash.update(meta.ino().to_le_bytes());
                hash.update(meta.ctime().to_le_bytes());
                hash.update(meta.ctime_nsec().to_le_bytes());
            }
            for (out, value) in digest.iter_mut().zip(hash.finalize()) {
                *out ^= value;
            }
            count += 1;
        }
    }
    let mut hash = Sha256::new();
    hash.update(digest);
    hash.update(count.to_le_bytes());
    result.revision = format!("{:x}", hash.finalize());
    result
}

pub struct WorkDirectory {
    _lease: File,
    directory: tempfile::TempDir,
}
impl WorkDirectory {
    pub fn path(&self) -> &Path {
        self.directory.path()
    }
}

pub fn create_work(root: &Path) -> Result<WorkDirectory, String> {
    let work = root.join("ai-work");
    secure(root, &work)?;
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let directory = tempfile::Builder::new()
        .prefix("oiagent-")
        .tempdir_in(&work)
        .map_err(|e| e.to_string())?;
    let mut lease =
        File::create_new(directory.path().join(WORK_MARKER)).map_err(|e| e.to_string())?;
    lease.lock().map_err(|e| e.to_string())?;
    lease
        .write_all(directory.path().file_name().unwrap().as_encoded_bytes())
        .map_err(|e| e.to_string())?;
    Ok(WorkDirectory {
        _lease: lease,
        directory,
    })
}

pub fn work_lease(root: &Path, path: &Path) -> Result<File, String> {
    secure(root, path)?;
    if path.parent() != Some(root.join("ai-work").as_path())
        || !fs::symlink_metadata(path).is_ok_and(|m| m.is_dir())
    {
        return Err("无效临时工作目录".into());
    }
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无效临时目录名称")?;
    if !name.starts_with("oiagent-")
        || name.len() > 100
        || !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
    {
        return Err("无法确认临时文件归属，已保护".into());
    }
    let marker = path.join(WORK_MARKER);
    secure(root, &marker)?;
    let meta = fs::symlink_metadata(&marker).map_err(|_| "缺少临时文件归属标记，已保护")?;
    if !meta.is_file()
        || meta.len() > 100
        || fs::read_to_string(&marker).map_err(|e| e.to_string())? != name
    {
        return Err("临时文件归属标记无效，已保护".into());
    }
    if !meta
        .modified()
        .is_ok_and(|t| t.elapsed().is_ok_and(|age| age >= STALE_WORK))
    {
        return Err("创建未满 24 小时，暂不清理".into());
    }
    let lease = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(marker)
        .map_err(|e| e.to_string())?;
    lease
        .try_lock()
        .map_err(|_| "AI 辅助任务正在使用，已保护")?;
    Ok(lease)
}

pub fn cleanup_stale_work(root: &Path) {
    let path = root.join("ai-work");
    if secure(root, &path).is_err() {
        return;
    }
    let Ok(entries) = fs::read_dir(path) else {
        return;
    };
    let mut budget = Budget::default();
    for entry in entries.flatten().take(10_000) {
        if let Ok(lease) = work_lease(root, &entry.path()) {
            if measure(root, &[entry.path()], &HashSet::new(), &mut budget)
                .warning
                .is_none()
            {
                // No worker reopens old work directories. Close the lease before
                // removing its file, also supported on Windows.
                drop(lease);
                let _ = fs::remove_dir_all(entry.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exhausted_scan_budget_protects_incomplete_items() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("file");
        fs::write(&path, "keep").unwrap();
        let mut budget = Budget {
            start: Instant::now(),
            entries: 500_000,
        };
        let result = measure(dir.path(), &[path.clone()], &HashSet::new(), &mut budget);
        assert!(result.warning.is_some());
        assert_eq!(fs::read_to_string(path).unwrap(), "keep");
    }
}
