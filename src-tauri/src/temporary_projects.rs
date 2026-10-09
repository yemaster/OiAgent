use crate::{models::*, store::AppState};
use chrono::{DateTime, Duration, Utc};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{Manager, State};

const RETENTION_DAYS: i64 = 7;
const MARKER: &str = ".oiagent-project";

fn root(state: &AppState, name: &str) -> Result<PathBuf, String> {
    let base = fs::canonicalize(&state.dir).map_err(|e| e.to_string())?;
    let path = base.join(name);
    if !path.exists() {
        fs::create_dir(&path).map_err(|e| e.to_string())?;
    }
    let meta = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return Err("临时项目存储目录无效".into());
    }
    Ok(path)
}
fn name(id: &str) -> Result<String, String> {
    let id = uuid::Uuid::parse_str(id).map_err(|_| "临时项目标识无效")?;
    Ok(format!("临时项目-{id}"))
}
fn paths(state: &AppState, project: &TemporaryProject) -> Result<(PathBuf, PathBuf), String> {
    let source = root(state, "temporary-projects")?.join(name(&project.id)?);
    if source != Path::new(&project.path) {
        return Err("临时项目路径不匹配，已取消清理".into());
    }
    let trash = root(state, "temporary-trash")?.join(&project.id);
    Ok((source, trash))
}
fn verify(path: &Path, id: &str) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    let marker = path.join(MARKER);
    let marker_meta = fs::symlink_metadata(&marker).map_err(|e| e.to_string())?;
    if metadata.file_type().is_symlink()
        || !metadata.is_dir()
        || marker_meta.file_type().is_symlink()
        || !marker_meta.is_file()
        || marker_meta.len() > 64
        || fs::read_to_string(marker).map_err(|e| e.to_string())? != id
    {
        return Err("无法确认临时目录归属，已取消清理".into());
    }
    Ok(())
}
pub fn contains(project: &str, path: &str) -> bool {
    Path::new(path).starts_with(project)
}
pub fn unavailable(db: &Database, path: &str) -> bool {
    db.temporary_projects
        .iter()
        .any(|p| matches!(p.status.as_str(), "cleaning" | "cleaned") && contains(&p.path, path))
}
pub fn check_available(db: &Database, path: &str) -> Result<(), String> {
    if unavailable(db, path) {
        Err("临时项目文件已清理，或正在清理。请新建任务并选择其他目录。".into())
    } else {
        Ok(())
    }
}
fn idle(db: &Database, project: &str) -> bool {
    !db.tasks.iter().any(|t| {
        contains(project, &t.project)
            && (["running", "waiting", "queued"].contains(&t.status.as_str())
                || !t.queued_messages.is_empty())
    })
}
fn archived_group(db: &Database, task: &Task) -> bool {
    let mut current = task;
    for _ in 0..=db.tasks.len() {
        if db.archived.contains(&current.id) {
            return true;
        }
        match current
            .parent_id
            .as_ref()
            .and_then(|id| db.tasks.iter().find(|t| &t.id == id))
        {
            Some(parent) => current = parent,
            None => return false,
        }
    }
    false
}
pub fn restore_group(db: &mut Database, id: &str) {
    let mut current = Some(id.to_string());
    for _ in 0..=db.tasks.len() {
        let Some(id) = current else {
            break;
        };
        db.archived.retain(|archived| archived != &id);
        current = db
            .tasks
            .iter()
            .find(|t| t.id == id)
            .and_then(|t| t.parent_id.clone());
    }
}

/// Called when archive state changes. A restore or new task cancels eligibility.
pub fn update_expiry(db: &mut Database, at: DateTime<Utc>) {
    for index in 0..db.temporary_projects.len() {
        let p = &db.temporary_projects[index];
        if p.status != "active" {
            continue;
        }
        let tasks: Vec<_> = db
            .tasks
            .iter()
            .filter(|t| contains(&p.path, &t.project))
            .collect();
        let eligible = idle(db, &p.path) && tasks.iter().all(|t| archived_group(db, t));
        let empty = tasks.is_empty();
        let p = &mut db.temporary_projects[index];
        if !eligible {
            p.cleanup_after = None;
        } else if p.cleanup_after.is_none() {
            let from = if empty {
                DateTime::parse_from_rfc3339(&p.created_at)
                    .map(|d| d.with_timezone(&Utc))
                    .unwrap_or(at)
            } else {
                at
            };
            p.cleanup_after = Some((from + Duration::days(RETENTION_DAYS)).to_rfc3339());
        }
    }
}
pub fn allocate(state: &AppState) -> Result<TemporaryProject, String> {
    let _guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let path = root(state, "temporary-projects")?.join(name(&id)?);
    fs::create_dir(&path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    if let Err(e) = fs::write(path.join(MARKER), &id) {
        let _ = fs::remove_dir(&path);
        return Err(e.to_string());
    }
    let project = TemporaryProject {
        id,
        path: path.to_string_lossy().into(),
        created_at: now(),
        status: "active".into(),
        cleanup_after: Some((Utc::now() + Duration::days(RETENTION_DAYS)).to_rfc3339()),
    };
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let mut next = db.clone();
    next.temporary_projects.push(project.clone());
    next.projects.push(project.path.clone());
    if let Err(e) = state.save(&next) {
        let _ = fs::remove_dir_all(path);
        return Err(e);
    }
    *db = next;
    Ok(project)
}
#[tauri::command]
pub async fn create_temporary_project(app: tauri::AppHandle) -> Result<TemporaryProject, String> {
    tauri::async_runtime::spawn_blocking(move || allocate(&app.state::<AppState>()))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn keep_temporary_project(state: State<AppState>, id: String) -> Result<(), String> {
    keep(&state, &id)
}
pub fn keep(state: &AppState, id: &str) -> Result<(), String> {
    let _guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let mut next = db.clone();
    let p = next
        .temporary_projects
        .iter_mut()
        .find(|p| p.id == id)
        .ok_or("临时项目不存在")?;
    if p.status != "active" {
        return Err("此项目无法保留".into());
    }
    let (path, _) = paths(state, p)?;
    verify(&path, id)?;
    p.status = "kept".into();
    p.cleanup_after = None;
    state.save(&next)?;
    *db = next;
    Ok(())
}
/// Only the owned folder is moved here. Recursive deletion runs off the startup/UI path.
fn stage_cleanup(state: &AppState, id: &str) -> Result<PathBuf, String> {
    let _guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    // Never wait for a worker while holding the database lock.
    let children = state
        .children
        .try_lock()
        .map_err(|_| "任务正在切换状态，请稍后重试")?;
    let ptys = state
        .ptys
        .try_lock()
        .map_err(|_| "终端正在切换状态，请稍后重试")?;
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let p = db
        .temporary_projects
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or("临时项目不存在")?;
    if p.status == "kept" {
        return Err("已保留的项目不会清理".into());
    }
    if !idle(&db, &p.path)
        || db.tasks.iter().any(|t| {
            contains(&p.path, &t.project)
                && (children.contains_key(&t.id) || ptys.contains_key(&t.id))
        })
    {
        return Err("项目仍有运行中、待启动或待发送的任务，请先结束任务".into());
    }
    let (source, trash) = paths(state, &p)?;
    if source.try_exists().map_err(|e| e.to_string())? {
        verify(&source, id)?;
        if trash.try_exists().map_err(|e| e.to_string())? {
            return Err("清理目录已存在，请稍后重试".into());
        }
    } else if trash.try_exists().map_err(|e| e.to_string())? {
        if !["cleaning", "cleaned"].contains(&p.status.as_str()) {
            return Err("清理目录状态不匹配".into());
        }
        verify_staged(&trash, id)?;
    }
    let mut next = db.clone();
    next.temporary_projects
        .iter_mut()
        .find(|p| p.id == id)
        .unwrap()
        .status = "cleaning".into();
    state.save(&next)?;
    *db = next;
    if source.exists() {
        fs::rename(source, &trash).map_err(|e| e.to_string())?;
    }
    let mut next = db.clone();
    let p = next
        .temporary_projects
        .iter_mut()
        .find(|p| p.id == id)
        .unwrap();
    p.status = "cleaned".into();
    p.cleanup_after = None;
    let path = p.path.clone();
    next.projects.retain(|p| !contains(&path, p));
    for t in &next.tasks {
        if contains(&path, &t.project) && !next.archived.contains(&t.id) {
            next.archived.push(t.id.clone());
        }
    }
    state.save(&next)?;
    *db = next;
    Ok(trash)
}
// A prior recursive deletion may have removed the marker before being interrupted.
// The persisted cleanup state and private trash path now establish ownership.
fn verify_staged(path: &Path, id: &str) -> Result<(), String> {
    uuid::Uuid::parse_str(id).map_err(|_| "无效清理标识")?;
    crate::integrations::secure_path(path)?;
    if path.file_name().and_then(|n| n.to_str()) != Some(id)
        || path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            != Some("temporary-trash")
        || !fs::symlink_metadata(path)
            .map_err(|e| e.to_string())?
            .is_dir()
    {
        return Err("清理目录无效".into());
    }
    Ok(())
}
fn dispose(path: PathBuf, id: String) {
    if !path.exists() {
        return;
    }
    if let Err(error) =
        verify_staged(&path, &id).and_then(|_| fs::remove_dir_all(path).map_err(|e| e.to_string()))
    {
        eprintln!("临时文件清理未完成，下次启动重试：{error}");
    }
}
#[tauri::command]
pub async fn cleanup_temporary_project(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let trash = stage_cleanup(&app.state::<AppState>(), &id)?;
        // Await manual cleanup so errors can be surfaced; retry remnants at startup.
        if trash.exists() {
            verify_staged(&trash, &id)?;
            fs::remove_dir_all(trash).map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Runs before the first window is usable: no editor buffers can be open yet.
pub fn startup(state: &AppState) -> Result<(), String> {
    let candidates = {
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        update_expiry(&mut db, Utc::now());
        state.save(&db)?;
        db.temporary_projects
            .iter()
            .filter(|p| {
                p.status == "cleaning"
                    || p.status == "cleaned"
                    || (p.status == "active"
                        && p.cleanup_after
                            .as_ref()
                            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                            .is_some_and(|d| d <= Utc::now()))
            })
            .map(|p| p.id.clone())
            .collect::<Vec<_>>()
    };
    let mut pending = vec![];
    for id in candidates {
        match stage_cleanup(state, &id) {
            Ok(path) => pending.push((path, id)),
            Err(error) => eprintln!("临时项目暂未清理：{error}"),
        }
    }
    if !pending.is_empty() {
        std::thread::spawn(move || {
            for (path, id) in pending {
                dispose(path, id);
            }
        });
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task(path: &str, status: &str) -> Task {
        serde_json::from_value(serde_json::json!({"id":"t", "title":"test", "prompt":"test", "project":path, "agentId":"custom", "agentKind":"custom", "status":status, "createdAt":now(), "updatedAt":now(), "preview":"", "usage":Usage::default(), "source":"managed", "model":"", "permission":"read-only"})).unwrap()
    }
    #[test]
    fn allocates_distinct_owned_directories_and_keeps_them_across_restart() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let a = allocate(&state).unwrap();
        let b = allocate(&state).unwrap();
        assert_ne!(a.path, b.path);
        assert!(Path::new(&a.path).is_dir());
        assert!(verify(Path::new(&a.path), &a.id).is_ok());
        keep(&state, &a.id).unwrap();
        assert!(stage_cleanup(&state, &a.id).is_err());
        let restored = AppState::load(dir.path().into()).unwrap();
        assert_eq!(
            restored.db.lock().unwrap().temporary_projects[0].status,
            "kept"
        );
    }
    #[test]
    fn cleanup_preserves_logs_and_blocks_unfinished_tasks() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let p = allocate(&state).unwrap();
        state
            .db
            .lock()
            .unwrap()
            .tasks
            .push(task(&p.path, "running"));
        assert!(stage_cleanup(&state, &p.id).is_err());
        state.db.lock().unwrap().tasks[0].status = "queued".into();
        assert!(stage_cleanup(&state, &p.id).is_err());
        state.db.lock().unwrap().tasks[0].status = "completed".into();
        fs::write(state.log_path("t"), "history").unwrap();
        fs::write(Path::new(&p.path).join("output.txt"), "result").unwrap();
        let trash = stage_cleanup(&state, &p.id).unwrap();
        assert!(!Path::new(&p.path).exists());
        assert!(trash.join("output.txt").exists());
        assert_eq!(fs::read_to_string(state.log_path("t")).unwrap(), "history");
        let db = state.db.lock().unwrap();
        assert!(db.archived.contains(&"t".to_string()));
        assert!(unavailable(&db, &p.path));
        drop(db);
        dispose(trash.clone(), p.id);
        assert!(!trash.exists());
    }
    #[test]
    fn retention_starts_at_archive_and_resets_on_restore() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let p = allocate(&state).unwrap();
        let mut db = state.db.lock().unwrap();
        db.tasks.push(task(&p.path, "completed"));
        let mut child = task(&p.path, "completed");
        child.id = "child".into();
        child.parent_id = Some("t".into());
        db.tasks.push(child);
        let at = Utc::now();
        update_expiry(&mut db, at);
        assert!(db.temporary_projects[0].cleanup_after.is_none());
        db.archived.push("t".into());
        update_expiry(&mut db, at);
        let expiry = db.temporary_projects[0].cleanup_after.clone().unwrap();
        assert_eq!(expiry, (at + Duration::days(7)).to_rfc3339());
        update_expiry(&mut db, at + Duration::days(1));
        assert_eq!(
            db.temporary_projects[0].cleanup_after.as_ref().unwrap(),
            &expiry
        );
        restore_group(&mut db, "child");
        update_expiry(&mut db, at);
        assert!(db.temporary_projects[0].cleanup_after.is_none());
    }
    #[test]
    fn startup_cleans_expired_archives_but_preserves_active_and_kept_projects() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let expired = allocate(&state).unwrap();
        let active = allocate(&state).unwrap();
        let kept = allocate(&state).unwrap();
        keep(&state, &kept.id).unwrap();
        {
            let mut db = state.db.lock().unwrap();
            db.tasks.push(task(&active.path, "completed"));
            db.temporary_projects[0].cleanup_after =
                Some((Utc::now() - Duration::days(1)).to_rfc3339());
        }
        startup(&state).unwrap();
        assert!(!Path::new(&expired.path).exists());
        assert!(Path::new(&active.path).exists());
        assert!(Path::new(&kept.path).exists());
        assert!(crate::snapshot_inner(&state, false, true)
            .unwrap()
            .projects
            .iter()
            .all(|p| p != &expired.path));
    }
    #[test]
    fn refuses_unowned_or_rewritten_paths() {
        let dir = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let p = allocate(&state).unwrap();
        fs::write(external.path().join("keep.txt"), "keep").unwrap();
        state.db.lock().unwrap().temporary_projects[0].path =
            external.path().to_string_lossy().into();
        assert!(stage_cleanup(&state, &p.id).is_err());
        assert!(external.path().join("keep.txt").exists());
        state.db.lock().unwrap().temporary_projects[0].path = p.path.clone();
        fs::remove_file(Path::new(&p.path).join(MARKER)).unwrap();
        assert!(stage_cleanup(&state, &p.id).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn does_not_follow_symlinks_during_cleanup() {
        let dir = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let p = allocate(&state).unwrap();
        fs::write(external.path().join("keep.txt"), "keep").unwrap();
        std::os::unix::fs::symlink(external.path(), Path::new(&p.path).join("linked")).unwrap();
        let trash = stage_cleanup(&state, &p.id).unwrap();
        dispose(trash, p.id);
        assert!(external.path().join("keep.txt").exists());
    }
    #[test]
    fn retries_partial_deletion_without_its_removed_marker() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let p = allocate(&state).unwrap();
        fs::write(Path::new(&p.path).join("remaining.txt"), "remaining").unwrap();
        let trash = stage_cleanup(&state, &p.id).unwrap();
        fs::remove_file(trash.join(MARKER)).unwrap();
        assert_eq!(stage_cleanup(&state, &p.id).unwrap(), trash);
        dispose(trash.clone(), p.id);
        assert!(!trash.exists());
    }
}
