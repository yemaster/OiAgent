use crate::deletion_files::{self, DeleteOptions, DeletionFile};
use crate::{models::*, store::AppState};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use tauri::{Manager, State};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ItemMark {
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub color: Option<String>,
}
#[tauri::command]
pub fn workspace_marks(state: State<AppState>) -> HashMap<String, ItemMark> {
    state.db.lock().unwrap().workspace_marks.clone()
}
#[tauri::command]
pub fn mark_workspace_item(
    state: State<AppState>,
    key: String,
    patch: serde_json::Value,
) -> Result<HashMap<String, ItemMark>, String> {
    update_mark(&state, key, patch)
}
fn update_mark(
    state: &AppState,
    key: String,
    patch: serde_json::Value,
) -> Result<HashMap<String, ItemMark>, String> {
    if key.len() > 8192 || !(key.starts_with("task:") || key.starts_with("project:")) {
        return Err("无效的标记对象".into());
    }
    let values = patch.as_object().ok_or("标记格式无效")?;
    if values
        .keys()
        .any(|k| !["pinned", "color"].contains(&k.as_str()))
    {
        return Err("未知标记字段".into());
    }
    let mut db = state.db.lock().unwrap();
    let mut next = db.clone();
    let mark = next.workspace_marks.entry(key.clone()).or_default();
    if let Some(value) = values.get("pinned") {
        mark.pinned = value.as_bool().ok_or("置顶状态无效")?;
    }
    if let Some(value) = values.get("color") {
        mark.color = if value.is_null() {
            None
        } else {
            let color = value.as_str().ok_or("颜色无效")?;
            if !["red", "orange", "yellow", "green", "blue", "purple"].contains(&color) {
                return Err("未知颜色".into());
            }
            Some(color.into())
        };
    }
    if !mark.pinned && mark.color.is_none() {
        next.workspace_marks.remove(&key);
    }
    state.save(&next)?;
    *db = next;
    Ok(db.workspace_marks.clone())
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteResult {
    pub ids: Vec<String>,
    pub cleanup_warnings: Vec<String>,
    pub deleted_projects: Vec<String>,
}

pub fn deletion_ids(tasks: &[Task], ids: &[String]) -> HashSet<String> {
    let mut all: HashSet<String> = ids.iter().cloned().collect();
    loop {
        let before = all.len();
        for task in tasks {
            if task.parent_id.as_ref().is_some_and(|id| all.contains(id)) {
                all.insert(task.id.clone());
            }
        }
        if all.len() == before {
            return all;
        }
    }
}
#[tauri::command]
pub async fn preview_archived_deletion(
    app: tauri::AppHandle,
    ids: Vec<String>,
    open_projects: Option<Vec<String>>,
) -> Result<Vec<DeletionFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let snapshot = crate::snapshot_inner(&state, false, false)?;
        if ids.is_empty()
            || ids.len() > 10000
            || ids
                .iter()
                .any(|id| !snapshot.tasks.iter().any(|t| &t.id == id && t.archived))
        {
            return Err("请选择有效的归档会话".into());
        }
        let removed = deletion_ids(&snapshot.tasks, &ids);
        let imported = state.history.lock().unwrap().cached();
        let db = state.db.lock().unwrap();
        Ok(deletion_files::plan(
            &state,
            &db,
            &snapshot.tasks,
            &imported,
            &removed,
            &open_projects.unwrap_or_default(),
            &deletion_files::roots(),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn delete_archived_tasks(
    app: tauri::AppHandle,
    ids: Vec<String>,
    options: Option<DeleteOptions>,
    confirmed_files: Option<Vec<DeletionFile>>,
    open_projects: Option<Vec<String>>,
) -> Result<DeleteResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        delete_with_options(
            &app.state::<AppState>(),
            ids,
            None,
            options.unwrap_or_default(),
            confirmed_files,
            &open_projects.unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn delete_archived(
    state: &AppState,
    ids: Vec<String>,
    allowed: Option<&HashSet<String>>,
) -> Result<DeleteResult, String> {
    delete_with_options(state, ids, allowed, DeleteOptions::default(), None, &[])
}
pub fn delete_with_options(
    state: &AppState,
    ids: Vec<String>,
    allowed: Option<&HashSet<String>>,
    options: DeleteOptions,
    confirmed_files: Option<Vec<DeletionFile>>,
    open_projects: &[String],
) -> Result<DeleteResult, String> {
    if allowed.is_some() && options.removes_files() {
        return Err("项目文件和原始历史请在执行设备上删除，局域网只支持删除会话记录".into());
    }
    if ids.is_empty() || ids.len() > 10000 {
        return Err("请选择 1–10000 条归档记录".into());
    }
    if allowed.is_some_and(|allowed| ids.iter().any(|id| !allowed.contains(id))) {
        return Err("任务不存在或无权访问".into());
    }
    let _gate = state.workflow_lock.lock().unwrap();
    let _project_gate = state.project_lock.lock().unwrap();
    let snapshot = crate::snapshot_inner(state, false, !options.removes_files())?;
    let imported = state.history.lock().unwrap().cached();
    for id in &ids {
        let task = snapshot
            .tasks
            .iter()
            .find(|t| &t.id == id)
            .ok_or("记录已变化，请刷新后重试")?;
        if !task.archived {
            return Err("只能删除已归档的记录".into());
        }
    }
    let removed = deletion_ids(&snapshot.tasks, &ids);
    let mut db = state.db.lock().unwrap();
    if ids.iter().any(|id| {
        !db.archived.contains(id)
            && !snapshot.tasks.iter().any(|task| {
                &task.id == id && crate::temporary_projects::unavailable(&db, &task.project)
            })
    }) {
        return Err("归档状态已变化，请刷新后重试".into());
    }
    // Recheck live database state, not only the UI snapshot. A parent deletion
    // includes its children and must not remove an active process or workflow.
    if snapshot.tasks.iter().chain(db.tasks.iter()).any(|t| {
        removed.contains(&t.id) && ["running", "waiting", "queued"].contains(&t.status.as_str())
    }) {
        return Err("记录中仍有未结束任务，请先停止或完成任务".into());
    }
    if allowed.is_some_and(|allowed| removed.iter().any(|id| !allowed.contains(id))) {
        return Err("包含无权删除的子任务，请在执行设备上处理".into());
    }
    if db.workflow_runs.iter().any(|r| {
        !removed.contains(&r.id)
            && r.steps
                .iter()
                .any(|s| s.task_ids.iter().any(|id| removed.contains(id)))
    }) {
        return Err("此任务属于工作流，请归档并删除对应的工作流记录".into());
    }
    let files = if options.removes_files() {
        let plan = deletion_files::plan(
            state,
            &db,
            &snapshot.tasks,
            &imported,
            &removed,
            open_projects,
            &deletion_files::roots(),
        );
        let files = deletion_files::selected(&plan, &options)?;
        if confirmed_files.as_ref() != Some(&files) {
            return Err("待删文件已变化，请重新打开删除窗口确认".into());
        }
        files
    } else {
        vec![]
    };
    let mut next = db.clone();
    next.deleted_tasks.extend(removed.iter().cloned());
    // Suppress imported aliases as well, so deleting a managed session cannot
    // cause its external history to reappear on the next scan.
    for task in snapshot.tasks.iter().filter(|t| removed.contains(&t.id)) {
        if let Some(sid) = &task.session_id {
            next.deleted_tasks
                .insert(format!("history-{}-{sid}", task.agent_kind));
        }
        for session in &task.sessions {
            next.deleted_tasks.insert(format!(
                "history-{}-{}",
                session.agent_kind, session.session_id
            ));
        }
        next.workspace_marks.remove(&format!("task:{}", task.id));
        next.titles.remove(&task.id);
    }
    next.tasks.retain(|t| !removed.contains(&t.id));
    next.workflow_runs.retain(|r| !removed.contains(&r.id));
    next.archived.retain(|id| !removed.contains(id));
    crate::temporary_projects::update_expiry(&mut next, chrono::Utc::now());
    state.save(&next)?;
    *db = next;
    let (deleted_projects, mut cleanup_warnings) = deletion_files::cleanup(&files);
    if !deleted_projects.is_empty() {
        let mut next = db.clone();
        next.projects.retain(|p| !deleted_projects.contains(p));
        for path in &deleted_projects {
            next.workspace_marks
                .remove(&format!("project:{}", serde_json::json!(["local", path])));
            if let Some(project) = next.temporary_projects.iter_mut().find(|p| &p.path == path) {
                project.status = "cleaned".into();
                project.cleanup_after = None;
            }
        }
        if let Err(error) = state.save(&next) {
            cleanup_warnings.push(format!("项目文件已删除，项目列表未能更新：{error}"));
        } else {
            *db = next;
        }
    }
    drop(db);
    for id in &removed {
        // Only OiAgent-owned log files, never an imported historyPath or project.
        if !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"-_".contains(&c))
        {
            continue;
        }
        for path in [
            state.log_path(id),
            state.dir.join("logs").join(format!("{id}.messages.jsonl")),
        ] {
            if let Err(error) = std::fs::remove_file(&path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    cleanup_warnings.push(format!("{}：{}", path.display(), error));
                }
            }
        }
    }
    Ok(DeleteResult {
        ids: removed.into_iter().collect(),
        cleanup_warnings,
        deleted_projects,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn task(id: &str, parent: Option<&str>) -> Task {
        serde_json::from_value(json!({"id":id,"title":id,"prompt":"","project":"/project","agentId":"codex","agentKind":"codex","status":"completed","createdAt":now(),"updatedAt":now(),"preview":"","usage":Usage::default(),"source":"managed","model":"","permission":"read-only","parentId":parent})).unwrap()
    }
    fn seed(state: &AppState, tasks: Vec<Task>, archived: &[&str]) {
        let mut db = state.db.lock().unwrap();
        db.tasks = tasks;
        db.archived = archived.iter().map(|id| id.to_string()).collect();
        state.save(&db).unwrap();
    }
    #[test]
    fn marks_persist_and_partial_updates_preserve_other_fields() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let key = "project:[\"local\",\"/project\"]".to_string();
        update_mark(&state, key.clone(), json!({"pinned":true})).unwrap();
        update_mark(&state, key.clone(), json!({"color":"blue"})).unwrap();
        assert!(update_mark(
            &state,
            key.clone(),
            json!({"pinned":false,"color":"unknown"})
        )
        .is_err());
        let restored = AppState::load(dir.path().into()).unwrap();
        let marks = &restored.db.lock().unwrap().workspace_marks;
        assert!(marks[&key].pinned);
        assert_eq!(marks[&key].color.as_deref(), Some("blue"));
        update_mark(&state, key.clone(), json!({"pinned":false,"color":null})).unwrap();
        assert!(!state.db.lock().unwrap().workspace_marks.contains_key(&key));
    }
    #[test]
    fn deletion_removes_descendants_and_owned_logs_but_preserves_original_files() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let original = dir.path().join("original-history.jsonl");
        std::fs::write(&original, "original").unwrap();
        let project = dir.path().join("project");
        std::fs::create_dir(&project).unwrap();
        std::fs::write(project.join("main.rs"), "source").unwrap();
        let mut root = task("root", None);
        root.history_path = Some(original.to_string_lossy().into());
        root.project = project.to_string_lossy().into();
        root.session_id = Some("native-session".into());
        seed(
            &state,
            vec![root, task("child", Some("root")), task("other", None)],
            &["root"],
        );
        std::fs::write(state.log_path("root"), "log").unwrap();
        std::fs::write(state.log_path("child"), "log").unwrap();
        std::fs::write(state.log_path("other"), "keep").unwrap();
        update_mark(&state, "task:root".into(), json!({"pinned":true})).unwrap();
        let result = delete_archived(&state, vec!["root".into()], None).unwrap();
        assert_eq!(
            result.ids.into_iter().collect::<HashSet<_>>(),
            HashSet::from(["root".into(), "child".into()])
        );
        assert!(result.cleanup_warnings.is_empty());
        assert!(!state.log_path("root").exists());
        assert!(!state.log_path("child").exists());
        assert!(state.log_path("other").exists());
        assert_eq!(std::fs::read_to_string(original).unwrap(), "original");
        assert_eq!(
            std::fs::read_to_string(project.join("main.rs")).unwrap(),
            "source"
        );
        let restored = AppState::load(dir.path().into()).unwrap();
        let db = restored.db.lock().unwrap();
        assert_eq!(db.tasks.len(), 1);
        assert!(db.deleted_tasks.contains("history-codex-native-session"));
        assert!(db.deleted_tasks.contains("child"));
        assert!(!db.workspace_marks.contains_key("task:root"));
    }
    #[test]
    fn deletion_is_atomic_and_rejects_active_children_unarchived_and_unauthorized_tasks() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let mut child = task("child", Some("root"));
        child.status = "running".into();
        seed(
            &state,
            vec![task("root", None), child, task("other", None)],
            &["root"],
        );
        assert!(delete_archived(&state, vec!["root".into()], None)
            .unwrap_err()
            .contains("未结束"));
        state.db.lock().unwrap().tasks[1].status = "completed".into();
        assert!(
            delete_archived(&state, vec!["root".into(), "other".into()], None)
                .unwrap_err()
                .contains("归档")
        );
        let allowed = HashSet::from(["root".into()]);
        assert!(delete_archived(&state, vec!["root".into()], Some(&allowed))
            .unwrap_err()
            .contains("子任务"));
        assert!(
            delete_archived(&state, vec!["other".into()], Some(&allowed))
                .unwrap_err()
                .contains("无权访问")
        );
        assert_eq!(state.db.lock().unwrap().tasks.len(), 3);
        assert!(state.db.lock().unwrap().deleted_tasks.is_empty());
    }
    #[test]
    fn failed_save_keeps_records_and_logs() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        seed(&state, vec![task("root", None)], &["root"]);
        std::fs::write(state.log_path("root"), "keep").unwrap();
        std::fs::create_dir(dir.path().join("state.json.tmp")).unwrap();
        assert!(delete_archived(&state, vec!["root".into()], None).is_err());
        assert_eq!(state.db.lock().unwrap().tasks.len(), 1);
        assert!(state.db.lock().unwrap().deleted_tasks.is_empty());
        assert!(state.log_path("root").exists());
    }
}
