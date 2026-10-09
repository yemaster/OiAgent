use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::Command,
};
use tauri::Manager;

const LIMIT: u64 = 2 * 1024 * 1024;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String,
    directory: bool,
    symlink: bool,
}
#[derive(Serialize)]
pub struct Directory {
    entries: Vec<FileEntry>,
    truncated: bool,
}
#[derive(Serialize)]
pub struct FileContent {
    pub content: String,
    pub revision: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    path: String,
    original_path: Option<String>,
    status: String,
    task_touched: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    git: bool,
    files: Vec<Change>,
    truncated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiff {
    original: String,
    modified: String,
    original_label: String,
}

fn root(project: &str) -> Result<PathBuf, String> {
    let p = fs::canonicalize(project).map_err(|_| "项目目录不存在或不可读")?;
    if !p.is_dir() {
        return Err("项目路径不是文件夹".into());
    }
    Ok(p)
}
fn relative(path: &str) -> Result<&Path, String> {
    let p = Path::new(path);
    if p.components()
        .any(|c| !matches!(c, Component::Normal(_) | Component::CurDir))
        || p.components().any(|c| c.as_os_str() == ".git")
    {
        return Err("文件必须位于项目目录内，不能访问 Git 内部目录".into());
    }
    Ok(p)
}
fn resolved(root: &Path, path: &str) -> Result<PathBuf, String> {
    let rel = relative(path)?;
    let mut next = root.to_path_buf();
    for c in rel.components() {
        next.push(c);
        if fs::symlink_metadata(&next)
            .map_err(|_| "文件不存在或不可读")?
            .file_type()
            .is_symlink()
        {
            return Err("暂不打开符号链接，请打开实际文件所在的项目".into());
        }
    }
    let p = fs::canonicalize(next).map_err(|_| "文件不存在或不可读")?;
    if !p.starts_with(root) {
        return Err("文件超出项目目录".into());
    }
    Ok(p)
}
fn text(bytes: Vec<u8>) -> Result<String, String> {
    if bytes.len() as u64 > LIMIT {
        return Err("文件超过 2 MB，请使用外部编辑器打开".into());
    }
    if bytes.contains(&0) {
        return Err("此文件是二进制或非 UTF-8 文件，暂不支持编辑".into());
    }
    String::from_utf8(bytes).map_err(|_| "仅支持 UTF-8 文本文件".into())
}
fn content_at(path: &Path) -> Result<FileContent, String> {
    let f = fs::File::open(path).map_err(|e| e.to_string())?;
    if !f.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("请选择普通文件".into());
    }
    let mut bytes = Vec::new();
    f.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let revision = format!("{:x}", Sha256::digest(&bytes));
    Ok(FileContent {
        content: text(bytes)?,
        revision,
    })
}
pub fn read(project: &str, path: &str) -> Result<FileContent, String> {
    content_at(&resolved(&root(project)?, path)?)
}
pub fn write(
    project: &str,
    path: &str,
    content: &str,
    revision: &str,
) -> Result<FileContent, String> {
    if content.len() as u64 > LIMIT || content.contains('\0') {
        return Err("仅支持不超过 2 MB 的文本文件".into());
    }
    let project = root(project)?;
    let target = resolved(&project, path)?;
    if content_at(&target)?.revision != revision {
        return Err("文件已被 Agent 或其他程序修改。请先比较磁盘版本，再保存。".into());
    }
    let permissions = fs::metadata(&target)
        .map_err(|e| e.to_string())?
        .permissions();
    if permissions.readonly() {
        return Err("文件为只读，无法保存".into());
    }
    let mut tmp = tempfile::NamedTempFile::new_in(target.parent().ok_or("文件路径无效")?)
        .map_err(|e| e.to_string())?;
    tmp.write_all(content.as_bytes())
        .map_err(|e| e.to_string())?;
    tmp.as_file()
        .set_permissions(permissions)
        .map_err(|e| e.to_string())?;
    tmp.as_file().sync_all().map_err(|e| e.to_string())?;
    // Recheck immediately before replacement, never silently overwrite an observed external edit.
    if resolved(&project, path)? != target || content_at(&target)?.revision != revision {
        return Err("保存期间磁盘文件发生变化，请重新比较后保存".into());
    }
    tmp.persist(&target).map_err(|e| e.to_string())?;
    content_at(&target)
}
fn listing(project: &str, path: &str, hidden: bool) -> Result<Directory, String> {
    let project = root(project)?;
    let path = resolved(&project, path)?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let Some(name) = entry.file_name().to_str().map(String::from) else {
            continue;
        };
        if name == ".git"
            || (!hidden
                && (name.starts_with('.')
                    || ["node_modules", "target", "dist", "build", "__pycache__"]
                        .contains(&name.as_str())))
        {
            continue;
        }
        if entries.len() >= 2000 {
            truncated = true;
            break;
        }
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        entries.push(FileEntry {
            name,
            path: entry
                .path()
                .strip_prefix(&project)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/"),
            directory: kind.is_dir(),
            symlink: kind.is_symlink(),
        });
    }
    entries.sort_by(|a, b| {
        b.directory
            .cmp(&a.directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(Directory { entries, truncated })
}
fn git(project: &Path, args: &[&str]) -> Result<std::process::Output, String> {
    use std::{
        process::Stdio,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };
    const OUTPUT_LIMIT: u64 = 8 * 1024 * 1024;
    let mut command = Command::new("git");
    command
        .arg("--no-optional-locks")
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
        ])
        .env_remove("GIT_DIR")
        .env_remove("GIT_WORK_TREE")
        .arg("-C")
        .arg(project)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|_| "无法运行 Git，请确认已安装 Git".to_string())?;
    let exceeded = Arc::new(AtomicBool::new(false));
    let read = |pipe: Box<dyn Read + Send>, exceeded: Arc<AtomicBool>| {
        std::thread::spawn(move || {
            let mut bytes = Vec::new();
            let result = pipe.take(OUTPUT_LIMIT + 1).read_to_end(&mut bytes);
            if bytes.len() as u64 > OUTPUT_LIMIT {
                exceeded.store(true, Ordering::Relaxed);
            }
            result.map(|_| bytes)
        })
    };
    let stdout = read(Box::new(child.stdout.take().unwrap()), exceeded.clone());
    let stderr = read(Box::new(child.stderr.take().unwrap()), exceeded.clone());
    let start = Instant::now();
    let mut error = None;
    let status = loop {
        if start.elapsed() > Duration::from_secs(10) || exceeded.load(Ordering::Relaxed) {
            error = Some("Git 读取超时或输出过大，请缩小项目范围后重试".to_string());
            #[cfg(unix)]
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            let _ = child.kill();
            break child.wait();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Ok(status),
            Err(e) => {
                let _ = child.kill();
                break Err(e);
            }
            _ => std::thread::sleep(Duration::from_millis(10)),
        }
    };
    let stdout = stdout
        .join()
        .map_err(|_| "读取 Git 输出失败")?
        .map_err(|e| e.to_string())?;
    let stderr = stderr
        .join()
        .map_err(|_| "读取 Git 错误信息失败")?
        .map_err(|e| e.to_string())?;
    if let Some(error) = error {
        return Err(error);
    }
    if exceeded.load(Ordering::Relaxed) {
        return Err("Git 输出超过读取上限".into());
    }
    Ok(std::process::Output {
        status: status.map_err(|e| e.to_string())?,
        stdout,
        stderr,
    })
}

fn repo(project: &Path) -> Result<Option<PathBuf>, String> {
    let result = git(project, &["rev-parse", "--show-toplevel"])?;
    if !result.status.success() {
        return Ok(None);
    }
    Ok(Some(root(String::from_utf8_lossy(&result.stdout).trim())?))
}
fn touched_paths(value: &serde_json::Value, project: &Path, paths: &mut HashSet<String>) {
    match value {
        serde_json::Value::Object(fields) => {
            for (k, v) in fields {
                if [
                    "file_path",
                    "filePath",
                    "path",
                    "absolute_path",
                    "target_file",
                ]
                .contains(&k.as_str())
                {
                    if let Some(s) = v.as_str() {
                        let p = Path::new(s);
                        let rel = if p.is_absolute() {
                            p.strip_prefix(project).ok()
                        } else {
                            Some(p)
                        };
                        if let Some(p) = rel {
                            paths.insert(p.to_string_lossy().replace('\\', "/"));
                        }
                    }
                }
                touched_paths(v, project, paths);
            }
        }
        serde_json::Value::Array(rows) => {
            for row in rows {
                touched_paths(row, project, paths);
            }
        }
        serde_json::Value::String(s) => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
                if !v.is_string() {
                    touched_paths(&v, project, paths);
                }
            }
            for line in s.lines() {
                for prefix in ["*** Update File: ", "*** Add File: ", "*** Delete File: "] {
                    if let Some(path) = line.strip_prefix(prefix) {
                        paths.insert(path.into());
                    }
                }
            }
        }
        _ => {}
    }
}
fn changes(project: &str, touched: HashSet<String>) -> Result<Changes, String> {
    let project = root(project)?;
    let Some(repo) = repo(&project)? else {
        return Ok(Changes {
            git: false,
            files: vec![],
            truncated: false,
        });
    };
    let output = git(
        &repo,
        &[
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--",
            project.to_str().ok_or("项目路径不是 UTF-8")?,
        ],
    )?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).into());
    }
    let mut files = Vec::new();
    let raw = String::from_utf8(output.stdout).map_err(|_| "Git 文件名包含不支持的编码")?;
    let mut rows = raw.split('\0');
    while let Some(row) = rows.next() {
        if row.len() < 4 {
            continue;
        }
        let status = &row[..2];
        let name = &row[3..];
        let old = if status.contains(['R', 'C']) {
            rows.next().map(String::from)
        } else {
            None
        };
        let full = repo.join(name);
        let Ok(rel) = full.strip_prefix(&project) else {
            continue;
        };
        let path = rel.to_string_lossy().replace('\\', "/");
        if relative(&path).is_err() {
            continue;
        }
        files.push(Change {
            task_touched: touched.contains(&path),
            path,
            original_path: old.and_then(|p| {
                repo.join(p)
                    .strip_prefix(&project)
                    .ok()
                    .map(|p| p.to_string_lossy().replace('\\', "/"))
            }),
            status: status.into(),
        });
        if files.len() >= 500 {
            break;
        }
    }
    let truncated = files.len() >= 500;
    Ok(Changes {
        git: true,
        files,
        truncated,
    })
}
fn diff(project: &str, path: &str, original_path: Option<&str>) -> Result<FileDiff, String> {
    let project = root(project)?;
    let rel = relative(path)?;
    let repo = repo(&project)?.ok_or("此项目不是 Git 仓库")?;
    let old = relative(original_path.unwrap_or(path))?;
    let old_path = project.join(old);
    let repo_path = old_path
        .strip_prefix(&repo)
        .map_err(|_| "文件不在仓库中")?
        .to_str()
        .ok_or("文件名不是 UTF-8")?
        .replace('\\', "/");
    let spec = format!("HEAD:{repo_path}");
    // Read blobs only. Never execute diff drivers, filters, hooks, or write to the index.
    let size = git(&repo, &["cat-file", "-s", &spec])?;
    if size.status.success()
        && String::from_utf8_lossy(&size.stdout)
            .trim()
            .parse::<u64>()
            .unwrap_or(LIMIT + 1)
            > LIMIT
    {
        return Err("历史文件超过 2 MB，请使用外部编辑器比较".into());
    }
    let output = git(&repo, &["cat-file", "blob", &spec])?;
    let original = if output.status.success() {
        text(output.stdout)?
    } else {
        String::new()
    };
    let modified = if project.join(rel).exists() {
        read(project.to_str().ok_or("路径无效")?, path)?.content
    } else {
        String::new()
    };
    Ok(FileDiff {
        original,
        modified,
        original_label: "HEAD（最近提交）".into(),
    })
}
#[tauri::command]
pub async fn project_files(
    project: String,
    path: String,
    hidden: bool,
) -> Result<Directory, String> {
    tauri::async_runtime::spawn_blocking(move || listing(&project, &path, hidden))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn search_project_files(
    project: String,
    query: String,
    hidden: bool,
) -> Result<Directory, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = root(&project)?;
        let query = query.trim().to_lowercase();
        if query.is_empty() {
            return Ok(Directory {
                entries: vec![],
                truncated: false,
            });
        }
        let mut entries = Vec::new();
        let mut truncated = false;
        let iter = walkdir::WalkDir::new(&root)
            .max_depth(30)
            .follow_links(false)
            .into_iter()
            .filter_entry(|e| {
                if e.depth() == 0 {
                    return true;
                }
                let name = e.file_name().to_string_lossy();
                name != ".git"
                    && (hidden
                        || (!name.starts_with('.')
                            && !["node_modules", "target", "dist", "build", "__pycache__"]
                                .contains(&name.as_ref())))
            });
        for (count, entry) in iter.enumerate() {
            if count >= 20000 || entries.len() >= 200 {
                truncated = true;
                break;
            }
            let Ok(entry) = entry else {
                continue;
            };
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry
                .path()
                .strip_prefix(&root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            if path.to_lowercase().contains(&query) {
                entries.push(FileEntry {
                    name: entry.file_name().to_string_lossy().into(),
                    path,
                    directory: false,
                    symlink: false,
                });
            }
        }
        Ok(Directory { entries, truncated })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_project_file(project: String, path: String) -> Result<FileContent, String> {
    tauri::async_runtime::spawn_blocking(move || read(&project, &path))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_project_file(
    project: String,
    path: String,
    content: String,
    revision: String,
) -> Result<FileContent, String> {
    tauri::async_runtime::spawn_blocking(move || write(&project, &path, &content, &revision))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn project_changes(
    app: tauri::AppHandle,
    project: String,
    task_id: Option<String>,
) -> Result<Changes, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut touched = HashSet::new();
        if let Some(id) = task_id {
            let state = app.state::<crate::store::AppState>();
            // Only accept an existing task ID, never a user-supplied log path.
            let task = state
                .db
                .lock()
                .unwrap()
                .tasks
                .iter()
                .find(|t| t.id == id && t.project == project)
                .cloned();
            if let Some(task) = task {
                let project_root = root(&project)?;
                if let Ok(mut file) = fs::File::open(
                    state
                        .dir
                        .join("logs")
                        .join(format!("{}.messages.jsonl", task.id)),
                ) {
                    let size = file.metadata().map_err(|e| e.to_string())?.len();
                    let _ = file.seek(SeekFrom::Start(size.saturating_sub(4 * 1024 * 1024)));
                    let mut bytes = Vec::new();
                    let _ = file.take(4 * 1024 * 1024).read_to_end(&mut bytes);
                    let raw = String::from_utf8_lossy(&bytes);
                    for line in raw.lines() {
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                            if let Some(tool) = v.get("tool") {
                                touched_paths(tool, &project_root, &mut touched);
                            }
                        }
                    }
                }
            }
        }
        changes(&project, touched)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn project_file_diff(
    project: String,
    path: String,
    original_path: Option<String>,
) -> Result<FileDiff, String> {
    tauri::async_runtime::spawn_blocking(move || diff(&project, &path, original_path.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn command(path: &Path, args: &[&str]) {
        assert!(git(path, args).unwrap().status.success());
    }
    #[test]
    fn edits_preserve_content_and_detect_external_changes() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_str().unwrap();
        fs::write(dir.path().join("代码.ts"), "const old = 1;\r\n").unwrap();
        let original = read(project, "代码.ts").unwrap();
        assert_eq!(original.content, "const old = 1;\r\n");
        fs::write(dir.path().join("代码.ts"), "Agent edit").unwrap();
        assert!(write(project, "代码.ts", "my edit", &original.revision).is_err());
        assert_eq!(read(project, "代码.ts").unwrap().content, "Agent edit");
        let disk = read(project, "代码.ts").unwrap();
        let saved = write(project, "代码.ts", "merged edit", &disk.revision).unwrap();
        assert_eq!(saved.content, "merged edit");
        assert_ne!(saved.revision, disk.revision);
    }
    #[test]
    fn rejects_escape_binary_and_oversized_files() {
        let dir = tempfile::tempdir().unwrap();
        let project = dir.path().to_str().unwrap();
        fs::write(dir.path().join("binary"), [0u8, 1, 2]).unwrap();
        fs::write(dir.path().join("large"), vec![b'a'; LIMIT as usize + 1]).unwrap();
        assert!(read(project, "../outside").is_err());
        assert!(read(project, "/etc/passwd").is_err());
        assert!(read(project, ".git/config").is_err());
        assert!(read(project, "binary").is_err());
        assert!(read(project, "large").is_err());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("/etc/passwd", dir.path().join("link")).unwrap();
            assert!(read(project, "link").is_err());
            assert!(write(project, "link", "bad", "").is_err());
        }
    }
    #[test]
    fn git_changes_cover_rename_delete_new_and_subproject_scope() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        command(p, &["init", "-q"]);
        command(p, &["config", "user.name", "Fixture"]);
        command(p, &["config", "user.email", "fixture@example.invalid"]);
        fs::create_dir(p.join("app")).unwrap();
        fs::write(p.join("app/old name.ts"), "before\n").unwrap();
        fs::write(p.join("app/delete.ts"), "removed\n").unwrap();
        fs::write(p.join("outside.ts"), "outside\n").unwrap();
        command(p, &["add", "."]);
        command(
            p,
            &["-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"],
        );
        command(p, &["mv", "app/old name.ts", "app/新文件.ts"]);
        fs::write(p.join("app/新文件.ts"), "after\n").unwrap();
        fs::remove_file(p.join("app/delete.ts")).unwrap();
        fs::write(p.join("app/new.ts"), "new\n").unwrap();
        fs::write(p.join("outside.ts"), "outside changed\n").unwrap();
        let project = p.join("app");
        let project = project.to_str().unwrap();
        let c = changes(project, HashSet::from(["新文件.ts".into()])).unwrap();
        assert!(c.git);
        assert_eq!(c.files.len(), 3);
        assert!(c.files.iter().all(|f| !f.path.contains("outside")));
        let rename = c.files.iter().find(|f| f.path == "新文件.ts").unwrap();
        assert!(rename.task_touched);
        let d = diff(project, &rename.path, rename.original_path.as_deref()).unwrap();
        assert_eq!(d.original, "before\n");
        assert_eq!(d.modified, "after\n");
        assert_eq!(diff(project, "delete.ts", None).unwrap().modified, "");
        assert_eq!(diff(project, "new.ts", None).unwrap().original, "");
    }
}
