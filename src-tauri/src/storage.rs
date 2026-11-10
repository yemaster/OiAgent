pub(crate) mod files;
#[cfg(test)]
mod tests;

use crate::{
    models::{Database, TemporaryProject},
    store::AppState,
    temporary_projects,
};
use files::{measure, Budget};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    id: String,
    category: String,
    name: String,
    paths: Vec<String>,
    bytes: u64,
    revision: String,
    blocked_reason: Option<String>,
    effect: String,
    cleanup_after: Option<String>,
    partial: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    data_dir: String,
    total_bytes: u64,
    cleanable_bytes: u64,
    items: Vec<Item>,
    partial: bool,
    retention_days: i64,
}
#[derive(Clone, Deserialize)]
pub struct Selection {
    id: String,
    revision: String,
}
#[derive(Serialize)]
pub struct Failure {
    id: String,
    message: String,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    deleted_items: Vec<String>,
    deleted_ids: Vec<String>,
    deleted_projects: Vec<String>,
    failures: Vec<Failure>,
}

fn base(state: &AppState) -> Result<PathBuf, String> {
    if fs::symlink_metadata(&state.dir).is_ok_and(|m| files::link(&m)) {
        return Err("应用数据目录是链接，无法安全清理".into());
    }
    dunce::canonicalize(&state.dir).map_err(|e| e.to_string())
}

pub(crate) fn task_paths(root: &Path, id: &str) -> Result<Vec<PathBuf>, String> {
    if id.is_empty()
        || id.len() > 200
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
    {
        return Err("无效任务标识，已保留记录文件".into());
    }
    let change = format!("changes-{:x}", Sha256::digest(id.as_bytes()));
    Ok(vec![
        root.join("workflow-inputs").join(id),
        root.join("logs").join(format!("{id}.jsonl")),
        root.join("logs").join(format!("{id}.messages.jsonl")),
        root.join("logs").join(format!("{id}.commands.json")),
        root.join("logs").join(format!("{id}.pty")),
        root.join("logs").join(format!("{change}.json")),
        root.join("logs").join(format!("{change}.native.json")),
    ])
}

/// Shared with automatic disposable-conversation cleanup; never follow a replaced
/// logs/workflow-inputs parent, and never interpret an arbitrary task ID as a path.
pub(crate) fn remove_task_files(state: &AppState, id: &str) -> Result<(), String> {
    let root = base(state)?;
    let paths = task_paths(&root, id)?;
    let result = measure(&root, &paths, &HashSet::new(), &mut Budget::default());
    if let Some(error) = result.warning {
        return Err(error);
    }
    for path in paths {
        files::secure(&root, &path)?;
        match fs::symlink_metadata(&path) {
            Ok(meta) => {
                let result = if meta.is_dir() {
                    fs::remove_dir_all(&path)
                } else {
                    fs::remove_file(&path)
                };
                result.map_err(|e| e.to_string())?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(())
}

fn project_item(
    root: &Path,
    p: &TemporaryProject,
    db: &Database,
    open: &[String],
    budget: &mut Budget,
) -> Item {
    let source = root
        .join("temporary-projects")
        .join(format!("临时项目-{}", p.id));
    let trash = root.join("temporary-trash").join(&p.id);
    let mut paths = vec![source.clone(), trash.clone()];
    let tasks: Vec<_> = db
        .tasks
        .iter()
        .filter(|t| temporary_projects::contains(&p.path, &t.project))
        .collect();
    let mut blocked = None;
    let ownership = (|| {
        if uuid::Uuid::parse_str(&p.id).is_err() || source != Path::new(&p.path) {
            return Err("临时项目路径或标识不匹配，已保护".to_owned());
        }
        for path in [&source, &trash] {
            files::secure(root, path)?;
        }
        if source.exists() {
            temporary_projects::verify(&source, &p.id)?;
        }
        if trash.exists() {
            if !matches!(p.status.as_str(), "cleaning" | "cleaned") || source.exists() {
                return Err("清理目录状态不匹配，已保护".into());
            }
            temporary_projects::verify_staged(&trash, &p.id)?;
        }
        if p.ephemeral {
            for t in &tasks {
                paths.extend(task_paths(root, &t.id)?);
            }
        }
        Ok(())
    })();
    if let Err(error) = ownership {
        blocked = Some(error);
        paths.clear();
    }
    if p.status == "kept" {
        blocked = Some("已保留的项目".into());
    }
    if !matches!(
        p.status.as_str(),
        "active" | "kept" | "cleaning" | "cleaned"
    ) {
        blocked = Some("项目状态未知，已保护".into());
    }
    if tasks.iter().any(|t| {
        matches!(
            t.status.as_str(),
            "running" | "waiting" | "queued" | "stopping"
        ) || !t.queued_messages.is_empty()
    }) {
        blocked = Some("仍有运行中、待启动或待发送的任务".into());
    }
    if open
        .iter()
        .filter(|path| !path.is_empty())
        .any(|path| Path::new(path).starts_with(&p.path) || Path::new(&p.path).starts_with(path))
    {
        blocked = Some("请先关闭此项目的文件标签或草稿".into());
    }
    let size = measure(root, &paths, &HashSet::new(), budget);
    let partial = size.warning.is_some();
    blocked = size.warning.or(blocked);
    let mut hash = Sha256::new();
    hash.update(size.revision.as_bytes());
    hash.update(serde_json::to_vec(p).unwrap_or_default());
    for task in &tasks {
        hash.update(serde_json::to_vec(task).unwrap_or_default());
    }
    Item {
        id: format!("project:{}", p.id),
        category: if p.status == "kept" {
            "kept"
        } else if p.ephemeral {
            "conversations"
        } else {
            "projects"
        }
        .into(),
        name: tasks
            .first()
            .map(|t| db.titles.get(&t.id).unwrap_or(&t.title).clone())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| {
                format!(
                    "{} · {}",
                    if p.ephemeral {
                        "临时对话"
                    } else {
                        "临时项目"
                    },
                    p.id.chars().take(8).collect::<String>()
                )
            }),
        paths: paths
            .iter()
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().into_owned())
            .collect(),
        bytes: size.bytes,
        revision: format!("{:x}", hash.finalize()),
        blocked_reason: blocked,
        effect: if p.ephemeral {
            "永久删除此临时对话的文件和 OiAgent 对话记录"
        } else {
            "永久删除项目文件，相关任务归档，对话记录保留"
        }
        .into(),
        cleanup_after: p.cleanup_after.clone(),
        partial,
    }
}

fn work_item(root: &Path, path: &Path, budget: &mut Budget) -> Item {
    let blocked = files::work_lease(root, path).err();
    let size = measure(root, &[path.to_owned()], &HashSet::new(), budget);
    Item {
        id: format!(
            "work:{}",
            path.file_name().unwrap_or_default().to_string_lossy()
        ),
        category: "temporary".into(),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        paths: vec![path.to_string_lossy().into()],
        bytes: size.bytes,
        revision: size.revision,
        partial: size.warning.is_some(),
        blocked_reason: size.warning.or(blocked),
        effect: "永久删除已结束的 AI 辅助任务临时文件".into(),
        cleanup_after: None,
    }
}

fn protected(root: &Path, path: &Path, excluded: &HashSet<PathBuf>, budget: &mut Budget) -> Item {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let (category, title, reason) = match name.as_ref() {
        "logs" | "workflow-inputs" => (
            "records",
            "会话记录与运行日志",
            "对话数据，请在归档页面选择记录删除",
        ),
        "attachments" => (
            "attachments",
            "会话附件",
            "附件可能被对话或未发送的草稿引用",
        ),
        "qoder-sdk" => ("runtime", "Qoder SDK", "Agent 运行所需组件"),
        "history-index.json" => ("cache", "历史记录索引", "历史同步正在维护此索引"),
        _ => (
            "other",
            name.as_ref(),
            "应用配置或无法确认归属的数据，已保护",
        ),
    };
    let size = measure(root, &[path.to_owned()], excluded, budget);
    Item {
        id: format!("protected:{}", path.display()),
        category: category.into(),
        name: title.into(),
        paths: vec![path.to_string_lossy().into()],
        bytes: size.bytes,
        revision: size.revision,
        partial: size.warning.is_some(),
        blocked_reason: Some(size.warning.unwrap_or_else(|| reason.into())),
        effect: String::new(),
        cleanup_after: None,
    }
}

fn scan(state: &AppState, open: &[String]) -> Result<Report, String> {
    let root = base(state)?;
    let db = state.db.lock().map_err(|e| e.to_string())?.clone();
    let mut budget = Budget::default();
    let mut items = vec![];
    let mut claimed = HashSet::new();
    let mut live: HashSet<String> = state
        .children
        .lock()
        .map_err(|e| e.to_string())?
        .keys()
        .cloned()
        .collect();
    live.extend(
        state
            .ptys
            .lock()
            .map_err(|e| e.to_string())?
            .keys()
            .cloned(),
    );
    live.extend(
        state
            .workflow_workers
            .lock()
            .map_err(|e| e.to_string())?
            .iter()
            .cloned(),
    );
    let mut truncated = false;
    for (index, p) in db.temporary_projects.iter().enumerate() {
        if index >= 20_000 {
            truncated = true;
            break;
        }
        let mut item = project_item(&root, p, &db, open, &mut budget);
        if db
            .tasks
            .iter()
            .any(|t| temporary_projects::contains(&p.path, &t.project) && live.contains(&t.id))
        {
            item.blocked_reason = Some("进程或终端仍在运行，请先结束任务".into());
        }
        claimed.extend(item.paths.iter().map(PathBuf::from));
        if !item.paths.is_empty()
            || (p.ephemeral
                && db
                    .tasks
                    .iter()
                    .any(|t| temporary_projects::contains(&p.path, &t.project)))
        {
            items.push(item);
        }
    }
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        if items.len() >= 20_000 {
            truncated = true;
            break;
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if matches!(
            entry.file_name().to_str(),
            Some("temporary-projects" | "temporary-trash" | "ai-work")
        ) && files::secure(&root, &path).is_ok()
            && path.is_dir()
        {
            for child in fs::read_dir(&path).map_err(|e| e.to_string())? {
                if items.len() >= 20_000 {
                    truncated = true;
                    break;
                }
                let child = child.map_err(|e| e.to_string())?.path();
                if claimed.contains(&child) {
                    continue;
                }
                items.push(if entry.file_name() == "ai-work" {
                    work_item(&root, &child, &mut budget)
                } else {
                    protected(&root, &child, &claimed, &mut budget)
                });
            }
        } else {
            items.push(protected(&root, &path, &claimed, &mut budget));
        }
    }
    items.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.id.cmp(&b.id)));
    Ok(Report {
        data_dir: root.to_string_lossy().into(),
        total_bytes: items.iter().map(|i| i.bytes).sum(),
        cleanable_bytes: items
            .iter()
            .filter(|i| i.blocked_reason.is_none())
            .map(|i| i.bytes)
            .sum(),
        partial: truncated || items.iter().any(|i| i.partial),
        items,
        retention_days: temporary_projects::RETENTION_DAYS,
    })
}

fn validate(item: &Item, selected: &Selection) -> Result<(), String> {
    if let Some(reason) = &item.blocked_reason {
        return Err(reason.clone());
    }
    if item.revision != selected.revision {
        return Err("文件或任务状态已变化，请重新扫描后确认".into());
    }
    Ok(())
}

fn delete(
    state: &AppState,
    selections: &[Selection],
    open: &[String],
) -> Result<DeleteResult, String> {
    if selections.is_empty()
        || selections.len() > 100
        || selections
            .iter()
            .map(|s| &s.id)
            .collect::<HashSet<_>>()
            .len()
            != selections.len()
    {
        return Err("请选择 1–100 个不同项目".into());
    }
    let root = base(state)?;
    let mut result = DeleteResult::default();
    for selected in selections {
        let removal = (|| {
            if let Some(id) = selected.id.strip_prefix("project:") {
                uuid::Uuid::parse_str(id).map_err(|_| "无效临时项目标识")?;
                let mut removed_ids = vec![];
                let mut path = String::new();
                let mut ephemeral = false;
                let trash = temporary_projects::stage_checked(state, id, |p, db| {
                    let item = project_item(&root, p, db, open, &mut Budget::default());
                    validate(&item, selected)?;
                    ephemeral = p.ephemeral;
                    path = p.path.clone();
                    if ephemeral {
                        removed_ids = db
                            .tasks
                            .iter()
                            .filter(|t| temporary_projects::contains(&p.path, &t.project))
                            .map(|t| t.id.clone())
                            .collect();
                    }
                    if state
                        .workflow_workers
                        .try_lock()
                        .map_err(|_| "工作流正在切换状态")?
                        .iter()
                        .any(|id| {
                            db.tasks.iter().any(|t| {
                                &t.id == id && temporary_projects::contains(&p.path, &t.project)
                            })
                        })
                    {
                        return Err("工作流仍在运行".into());
                    }
                    Ok(())
                })?;
                if trash.exists() {
                    temporary_projects::remove_staged(&trash, id)?;
                }
                if ephemeral {
                    temporary_projects::destroy_ephemeral(state, id)?;
                }
                result.deleted_ids.extend(removed_ids);
                result.deleted_projects.push(path);
            } else if let Some(name) = selected.id.strip_prefix("work:") {
                if name.is_empty()
                    || !name
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
                {
                    return Err("无效临时文件标识".into());
                }
                let path = root.join("ai-work").join(name);
                let item = work_item(&root, &path, &mut Budget::default());
                validate(&item, selected)?;
                let lease = files::work_lease(&root, &path)?;
                drop(lease);
                fs::remove_dir_all(path).map_err(|e| e.to_string())?;
            } else {
                return Err("此项目不允许通过存储清理删除".into());
            }
            Ok(())
        })();
        match removal {
            Ok(()) => result.deleted_items.push(selected.id.clone()),
            Err(message) => result.failures.push(Failure {
                id: selected.id.clone(),
                message,
            }),
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn scan_storage(
    app: tauri::AppHandle,
    open_projects: Vec<String>,
) -> Result<Report, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _gate = state
            .storage_lock
            .try_lock()
            .map_err(|_| "存储分析或清理正在进行")?;
        scan(&state, &open_projects)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_storage_items(
    app: tauri::AppHandle,
    items: Vec<Selection>,
    open_projects: Vec<String>,
    confirmed: bool,
) -> Result<DeleteResult, String> {
    if !confirmed {
        return Err("请先确认要永久删除的项目".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let _gate = state
            .storage_lock
            .try_lock()
            .map_err(|_| "存储分析或清理正在进行")?;
        delete(&state, &items, &open_projects)
    })
    .await
    .map_err(|e| e.to_string())?
}
