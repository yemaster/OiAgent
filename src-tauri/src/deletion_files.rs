use crate::{models::*, store::AppState};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct DeleteOptions {
    pub keep_project_files: bool,
    pub keep_agent_history: bool,
}
impl Default for DeleteOptions {
    fn default() -> Self {
        Self {
            keep_project_files: true,
            keep_agent_history: true,
        }
    }
}
impl DeleteOptions {
    pub fn removes_files(&self) -> bool {
        !self.keep_project_files || !self.keep_agent_history
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeletionFile {
    pub kind: String,
    pub path: String,
    pub revision: String,
    pub blocked_reason: Option<String>,
}
fn related(a: &Path, b: &Path) -> bool {
    a.starts_with(b) || b.starts_with(a)
}
fn resolved(path: &str) -> PathBuf {
    fs::canonicalize(path).unwrap_or_else(|_| PathBuf::from(path))
}
fn inspect(path: &Path, directory: bool) -> Result<(PathBuf, String), String> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("路径必须是绝对路径，且不能包含上级目录".into());
    }
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink()
        || (directory && !meta.is_dir())
        || (!directory && !meta.is_file())
    {
        return Err("路径类型已变化或是符号链接".into());
    }
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    let revision = if directory {
        format!("dir:{:?}", meta.created())
    } else {
        format!("{}:{:?}", meta.len(), meta.modified())
    };
    #[cfg(unix)]
    let revision = {
        use std::os::unix::fs::MetadataExt;
        format!("{revision}:{}:{}", meta.dev(), meta.ino())
    };
    Ok((canonical, revision))
}
fn history_paths(task: &Task, imported: &[Task]) -> HashSet<PathBuf> {
    let mut aliases = HashSet::new();
    if let Some(id) = &task.session_id {
        aliases.insert(format!("history-{}-{id}", task.agent_kind));
    }
    for s in &task.sessions {
        aliases.insert(format!("history-{}-{}", s.agent_kind, s.session_id));
    }
    task.history_path
        .iter()
        .chain(
            imported
                .iter()
                .filter(|t| aliases.contains(&t.id))
                .filter_map(|t| t.history_path.as_ref()),
        )
        .map(PathBuf::from)
        .collect()
}
fn protect_project(
    state: &AppState,
    db: &Database,
    path: &Path,
    roots: &[PathBuf],
) -> Result<(), String> {
    if path.parent().is_none() {
        return Err("不能删除磁盘根目录".into());
    }
    for protected in [
        dirs::home_dir(),
        dirs::desktop_dir(),
        dirs::document_dir(),
        dirs::download_dir(),
    ]
    .into_iter()
    .flatten()
    {
        if resolved(&protected.to_string_lossy()).starts_with(path) {
            return Err("不能删除用户主目录或系统常用目录".into());
        }
    }
    let data = resolved(&state.dir.to_string_lossy());
    if related(path, &data) {
        let temporary = db
            .temporary_projects
            .iter()
            .find(|p| resolved(&p.path) == path)
            .ok_or("不能删除应用数据目录")?;
        crate::temporary_projects::verify(path, &temporary.id)?;
    }
    for root in roots {
        let config = root.parent().unwrap_or(root);
        if related(path, config) {
            return Err("项目包含或位于 Agent 数据目录".into());
        }
    }
    #[cfg(unix)]
    for protected in [
        "/bin",
        "/sbin",
        "/usr",
        "/etc",
        "/System",
        "/Library",
        "/Applications",
        "/dev",
        "/proc",
        "/sys",
        "/boot",
    ] {
        if related(path, &resolved(protected)) {
            return Err("不能删除系统目录".into());
        }
    }
    #[cfg(windows)]
    for key in [
        "SystemRoot",
        "ProgramFiles",
        "ProgramFiles(x86)",
        "ProgramData",
    ] {
        if let Some(value) = std::env::var_os(key) {
            if related(path, &resolved(&value.to_string_lossy())) {
                return Err("不能删除系统目录".into());
            }
        }
    }
    Ok(())
}
pub fn plan(
    state: &AppState,
    db: &Database,
    tasks: &[Task],
    imported: &[Task],
    removed: &HashSet<String>,
    open_projects: &[String],
    roots: &[PathBuf],
) -> Vec<DeletionFile> {
    let mut candidates = BTreeMap::new();
    for task in tasks.iter().filter(|t| removed.contains(&t.id)) {
        candidates.insert(("project".to_owned(), PathBuf::from(&task.project)), ());
        for path in history_paths(task, imported) {
            candidates.insert(("history".to_owned(), path), ());
        }
    }
    let remaining: Vec<_> = tasks.iter().filter(|t| !removed.contains(&t.id)).collect();
    let shared_history: HashSet<_> = remaining
        .iter()
        .flat_map(|t| history_paths(t, imported))
        .map(|p| resolved(&p.to_string_lossy()))
        .collect();
    let mut result = BTreeMap::new();
    for ((kind, original), _) in candidates {
        if matches!(fs::symlink_metadata(&original), Err(e) if e.kind() == std::io::ErrorKind::NotFound)
        {
            continue;
        }
        let inspected = inspect(&original, kind == "project");
        let (path, revision) = inspected.clone().unwrap_or((original, String::new()));
        let blocked = inspected.err().or_else(|| {
            if kind == "project" {
                if let Err(e) = protect_project(state, db, &path, roots) {
                    return Some(e);
                }
                if remaining
                    .iter()
                    .any(|t| related(&path, &resolved(&t.project)))
                {
                    return Some("仍被其他会话使用，请保留项目文件".into());
                }
                if db
                    .projects
                    .iter()
                    .map(|p| resolved(p))
                    .any(|p| p != path && related(&p, &path))
                {
                    return Some("与其他项目目录重叠，请保留项目文件".into());
                }
                if open_projects.iter().any(|p| related(&path, &resolved(p))) {
                    return Some("项目中有打开的文件标签，请先关闭".into());
                }
            } else {
                if !roots.iter().any(|r| path.starts_with(r))
                    || path.extension().and_then(|e| e.to_str()) != Some("jsonl")
                {
                    return Some("不是已识别的 Agent 原始历史文件".into());
                }
                if shared_history.contains(&path) {
                    return Some("原始历史仍被其他会话引用".into());
                }
            }
            None
        });
        result.insert(
            (kind.clone(), path.clone()),
            DeletionFile {
                kind,
                path: path.to_string_lossy().into(),
                revision,
                blocked_reason: blocked,
            },
        );
    }
    result.into_values().collect()
}
pub fn roots() -> Vec<PathBuf> {
    crate::history::history_roots()
        .iter()
        .map(|(_, p)| resolved(&p.to_string_lossy()))
        .collect()
}
pub fn selected(
    plan: &[DeletionFile],
    options: &DeleteOptions,
) -> Result<Vec<DeletionFile>, String> {
    let selected: Vec<_> = plan
        .iter()
        .filter(|f| {
            if f.kind == "project" {
                !options.keep_project_files
            } else {
                !options.keep_agent_history
            }
        })
        .cloned()
        .collect();
    for file in &selected {
        if let Some(reason) = &file.blocked_reason {
            return Err(format!("{}：{reason}", file.path));
        }
    }
    Ok(selected)
}
// The database is saved first. Filesystem failures are reported individually;
// no unrelated path is accepted from the client and no symlink is followed.
pub fn cleanup(files: &[DeletionFile]) -> (Vec<String>, Vec<String>) {
    let mut warnings = vec![];
    let mut deleted_projects = vec![];
    // Remove history first, then directories, with nested projects before parents.
    let mut files = files.to_vec();
    files.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| b.path.len().cmp(&a.path.len()))
    });
    let mut deleted_roots: Vec<PathBuf> = vec![];
    for file in files {
        let path = Path::new(&file.path);
        if deleted_roots.iter().any(|p| path.starts_with(p)) {
            continue;
        }
        let deletion = (|| -> Result<(), String> {
            let (current, revision) = inspect(path, file.kind == "project")?;
            // Directory metadata can change when an already-approved nested path
            // was removed. Identity is rechecked before any filesystem operation.
            if current != path || revision != file.revision {
                return Err("路径或文件已变化，未删除".into());
            }
            if file.kind == "project" {
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    let device = fs::symlink_metadata(path).map_err(|e| e.to_string())?.dev();
                    for entry in walkdir::WalkDir::new(path).follow_links(false) {
                        let entry = entry.map_err(|e| e.to_string())?;
                        if entry.metadata().map_err(|e| e.to_string())?.dev() != device {
                            return Err("目录包含其他文件系统的挂载点，未删除".into());
                        }
                    }
                }
                fs::remove_dir_all(path).map_err(|e| e.to_string())?;
            } else {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
            Ok(())
        })();
        match deletion {
            Ok(()) if file.kind == "project" => {
                deleted_roots.push(path.into());
                deleted_projects.push(file.path);
            }
            Ok(()) => {}
            Err(e) => warnings.push(format!("{}：{e}", file.path)),
        }
    }
    (deleted_projects, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, AppState, Task, Vec<PathBuf>) {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().canonicalize().unwrap();
        let state = AppState::load(base.join("data")).unwrap();
        let project = base.join("project");
        fs::create_dir(&project).unwrap();
        fs::write(project.join("source.txt"), "keep").unwrap();
        let root = base.join(".claude/projects");
        fs::create_dir_all(&root).unwrap();
        let history = root.join("session.jsonl");
        fs::write(&history, "history").unwrap();
        let task = serde_json::from_value(serde_json::json!({"id":"one","title":"one","prompt":"","project":project,"historyPath":history,"agentId":"claude","agentKind":"claude","status":"completed","createdAt":now(),"updatedAt":now(),"preview":"","usage":Usage::default(),"source":"managed","model":"","permission":"read-only"})).unwrap();
        (dir, state, task, vec![root])
    }
    #[test]
    fn options_default_to_retaining_files_and_history_can_be_removed_independently() {
        let (_dir, state, task, roots) = fixture();
        let options: DeleteOptions = serde_json::from_str("{}").unwrap();
        assert!(!options.removes_files());
        let files = plan(
            &state,
            &Database::default(),
            &[task.clone()],
            &[],
            &HashSet::from([task.id.clone()]),
            &[],
            &roots,
        );
        assert_eq!(files.len(), 2);
        assert!(selected(&files, &options).unwrap().is_empty());
        let removing = selected(
            &files,
            &DeleteOptions {
                keep_agent_history: false,
                ..Default::default()
            },
        )
        .unwrap();
        let (projects, errors) = cleanup(&removing);
        assert!(projects.is_empty() && errors.is_empty());
        assert!(!Path::new(task.history_path.as_ref().unwrap()).exists());
        assert!(Path::new(&task.project).join("source.txt").exists());
    }
    #[test]
    fn rejects_shared_projects_shared_history_and_open_file_projects() {
        let (_dir, state, task, roots) = fixture();
        let mut other = task.clone();
        other.id = "two".into();
        let removed = HashSet::from([task.id.clone()]);
        let shared = plan(
            &state,
            &Database::default(),
            &[task.clone(), other],
            &[],
            &removed,
            &[],
            &roots,
        );
        assert!(shared.iter().all(|f| f.blocked_reason.is_some()));
        let opened = plan(
            &state,
            &Database::default(),
            &[task.clone()],
            &[],
            &removed,
            &[task.project.clone()],
            &roots,
        );
        assert!(opened
            .iter()
            .find(|f| f.kind == "project")
            .unwrap()
            .blocked_reason
            .as_ref()
            .unwrap()
            .contains("文件标签"));
        assert!(selected(
            &opened,
            &DeleteOptions {
                keep_project_files: false,
                ..Default::default()
            }
        )
        .is_err());
    }
    #[test]
    fn changed_history_is_not_deleted_and_protected_directories_are_blocked() {
        let (_dir, state, task, roots) = fixture();
        let files = plan(
            &state,
            &Database::default(),
            &[task.clone()],
            &[],
            &HashSet::from([task.id.clone()]),
            &[],
            &roots,
        );
        let removing = selected(
            &files,
            &DeleteOptions {
                keep_agent_history: false,
                ..Default::default()
            },
        )
        .unwrap();
        fs::write(task.history_path.as_ref().unwrap(), "new history data").unwrap();
        let (_, errors) = cleanup(&removing);
        assert_eq!(errors.len(), 1);
        assert!(Path::new(task.history_path.as_ref().unwrap()).exists());
        assert!(protect_project(&state, &Database::default(), &state.dir, &roots).is_err());
        assert!(protect_project(
            &state,
            &Database::default(),
            &dirs::home_dir().unwrap(),
            &roots
        )
        .is_err());
    }
    #[cfg(unix)]
    #[test]
    fn project_removal_preserves_external_symlink_target_and_history() {
        let (dir, state, task, roots) = fixture();
        let external = dir.path().join("external");
        fs::create_dir(&external).unwrap();
        fs::write(external.join("keep.txt"), "keep").unwrap();
        std::os::unix::fs::symlink(&external, Path::new(&task.project).join("link")).unwrap();
        let files = plan(
            &state,
            &Database::default(),
            &[task.clone()],
            &[],
            &HashSet::from([task.id.clone()]),
            &[],
            &roots,
        );
        let removing = selected(
            &files,
            &DeleteOptions {
                keep_project_files: false,
                ..Default::default()
            },
        )
        .unwrap();
        let (projects, errors) = cleanup(&removing);
        assert!(errors.is_empty(), "{errors:?}");
        assert_eq!(projects, vec![task.project.clone()]);
        assert!(!Path::new(&task.project).exists());
        assert!(external.join("keep.txt").exists());
        assert!(Path::new(task.history_path.as_ref().unwrap()).exists());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_history_and_outside_history_paths() {
        let (dir, state, mut task, roots) = fixture();
        let target = task.history_path.clone().unwrap();
        let link = roots[0].join("link.jsonl");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        task.history_path = Some(link.to_string_lossy().into());
        let removed = HashSet::from([task.id.clone()]);
        let files = plan(
            &state,
            &Database::default(),
            &[task.clone()],
            &[],
            &removed,
            &[],
            &roots,
        );
        assert!(selected(
            &files,
            &DeleteOptions {
                keep_agent_history: false,
                ..Default::default()
            }
        )
        .is_err());
        let outside = dir.path().join("outside.jsonl");
        fs::write(&outside, "keep").unwrap();
        task.history_path = Some(outside.to_string_lossy().into());
        let files = plan(
            &state,
            &Database::default(),
            &[task],
            &[],
            &removed,
            &[],
            &roots,
        );
        assert!(selected(
            &files,
            &DeleteOptions {
                keep_agent_history: false,
                ..Default::default()
            }
        )
        .is_err());
    }
}
