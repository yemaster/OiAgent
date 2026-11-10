use super::*;
use crate::models::{now, Task, Usage};
use chrono::{Duration, Utc};
use std::time::{Duration as StdDuration, SystemTime};

fn fixture() -> (tempfile::TempDir, AppState) {
    let dir = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(dir.path()).unwrap();
    let state = AppState::load(root).unwrap();
    (dir, state)
}
fn project(state: &AppState, ephemeral: bool) -> TemporaryProject {
    temporary_projects::allocate_with_mode(state, ephemeral).unwrap()
}
fn task(id: &str, project: &str, status: &str) -> Task {
    serde_json::from_value(serde_json::json!({"id":id,"title":"测试会话","prompt":"prompt","project":project,
        "agentId":"test","agentKind":"custom","source":"managed","status":status,"createdAt":now(),"updatedAt":now(),
        "preview":"","usage":Usage::default(),"model":"","permission":"read-only"})).unwrap()
}
fn selection(state: &AppState, id: &str) -> Selection {
    let report = scan(state, &[]).unwrap();
    let item = report.items.iter().find(|i| i.id == id).unwrap();
    Selection {
        id: item.id.clone(),
        revision: item.revision.clone(),
    }
}
fn stale_work(state: &AppState, name: &str) -> PathBuf {
    let path = state.dir.join("ai-work").join(name);
    fs::create_dir_all(&path).unwrap();
    fs::write(path.join(files::WORK_MARKER), name).unwrap();
    fs::File::open(path.join(files::WORK_MARKER))
        .unwrap()
        .set_modified(SystemTime::now() - StdDuration::from_secs(48 * 3600))
        .unwrap();
    path
}

#[test]
fn inventories_data_once_and_never_includes_external_project_contents() {
    let (_dir, state) = fixture();
    let external = tempfile::tempdir().unwrap();
    fs::write(external.path().join("code.rs"), vec![0; 100_000]).unwrap();
    state
        .db
        .lock()
        .unwrap()
        .projects
        .push(external.path().to_string_lossy().into());
    let p = project(&state, true);
    state
        .db
        .lock()
        .unwrap()
        .tasks
        .push(task("t", &p.path, "completed"));
    fs::write(state.log_path("t"), "history").unwrap();
    fs::write(Path::new(&p.path).join("file"), "contents").unwrap();
    fs::create_dir_all(state.dir.join("qoder-sdk")).unwrap();
    fs::write(state.dir.join("qoder-sdk/sdk.json"), "sdk").unwrap();
    let report = scan(&state, &[]).unwrap();
    let measured = measure(
        &state.dir,
        &[state.dir.clone()],
        &HashSet::new(),
        &mut Budget::default(),
    );
    assert!(!report.partial);
    assert_eq!(report.total_bytes, measured.bytes);
    let item = report
        .items
        .iter()
        .find(|i| i.id == format!("project:{}", p.id))
        .unwrap();
    assert_eq!(item.category, "conversations");
    assert_eq!(item.bytes, p.id.len() as u64 + 7 + 8);
    assert_eq!(report.cleanable_bytes, item.bytes);
    assert!(report
        .items
        .iter()
        .filter(|i| i.category == "runtime")
        .all(|i| i.blocked_reason.is_some()));
}

#[test]
fn normal_project_cleanup_preserves_dialogue_and_unrelated_files() {
    let (_dir, state) = fixture();
    let p = project(&state, false);
    let other = project(&state, false);
    state
        .db
        .lock()
        .unwrap()
        .tasks
        .push(task("t", &p.path, "completed"));
    fs::write(state.log_path("t"), "history").unwrap();
    fs::write(Path::new(&p.path).join("result"), "code").unwrap();
    let chosen = selection(&state, &format!("project:{}", p.id));
    let result = delete(&state, &[chosen], &[]).unwrap();
    assert_eq!(result.deleted_items.len(), 1);
    assert!(result.deleted_ids.is_empty());
    assert!(result.failures.is_empty());
    assert!(!Path::new(&p.path).exists());
    assert!(Path::new(&other.path).exists());
    assert_eq!(fs::read_to_string(state.log_path("t")).unwrap(), "history");
    assert!(state.db.lock().unwrap().archived.contains(&"t".into()));
}

#[test]
fn disposable_cleanup_removes_only_owned_records_including_children() {
    let (_dir, state) = fixture();
    let p = project(&state, true);
    let other = project(&state, false);
    let mut child = task("child", &p.path, "completed");
    child.parent_id = Some("t".into());
    state.db.lock().unwrap().tasks.extend([
        task("t", &p.path, "completed"),
        child,
        task("other", &other.path, "completed"),
    ]);
    for id in ["t", "child", "other"] {
        fs::write(state.log_path(id), id).unwrap();
    }
    let result = delete(
        &state,
        &[selection(&state, &format!("project:{}", p.id))],
        &[],
    )
    .unwrap();
    assert!(result.failures.is_empty());
    assert_eq!(result.deleted_ids.len(), 2);
    assert_eq!(state.db.lock().unwrap().tasks.len(), 1);
    assert!(!state.log_path("child").exists());
    assert_eq!(
        fs::read_to_string(state.log_path("other")).unwrap(),
        "other"
    );
}

#[test]
fn all_active_states_and_unsent_messages_block_manual_cleanup() {
    let (_dir, state) = fixture();
    let p = project(&state, true);
    let chosen = selection(&state, &format!("project:{}", p.id));
    for status in ["running", "waiting", "queued", "stopping"] {
        state.db.lock().unwrap().tasks = vec![task("t", &p.path, status)];
        let result = delete(&state, &[chosen.clone()], &[]).unwrap();
        assert_eq!(result.failures.len(), 1);
        assert!(Path::new(&p.path).exists());
        assert_eq!(state.db.lock().unwrap().tasks[0].status, status);
    }
    let mut pending = task("t", &p.path, "completed");
    pending.queued_messages.push(serde_json::from_value(serde_json::json!({"id":"q","text":"pending","agentId":"test","model":"","permission":"read-only","createdAt":now()})).unwrap());
    state.db.lock().unwrap().tasks = vec![pending];
    assert_eq!(delete(&state, &[chosen], &[]).unwrap().failures.len(), 1);
}

#[test]
fn process_registry_and_open_editors_are_rechecked_at_delete() {
    let (_dir, state) = fixture();
    let p = project(&state, false);
    state
        .db
        .lock()
        .unwrap()
        .tasks
        .push(task("t", &p.path, "completed"));
    let chosen = selection(&state, &format!("project:{}", p.id));
    assert!(scan(&state, &[String::new()])
        .unwrap()
        .items
        .iter()
        .find(|i| i.id == chosen.id)
        .unwrap()
        .blocked_reason
        .is_none());
    let result = delete(&state, &[chosen.clone()], &[p.path.clone()]).unwrap();
    assert!(result.failures[0].message.contains("文件标签"));
    state.workflow_workers.lock().unwrap().insert("t".into());
    let result = delete(&state, &[chosen], &[]).unwrap();
    assert!(result.failures[0].message.contains("工作流"));
    assert!(Path::new(&p.path).exists());
}

#[test]
fn changed_files_status_and_kept_projects_require_new_confirmation() {
    let (_dir, state) = fixture();
    let p = project(&state, false);
    let chosen = selection(&state, &format!("project:{}", p.id));
    fs::write(Path::new(&p.path).join("new-file"), "new work").unwrap();
    assert!(delete(&state, &[chosen.clone()], &[]).unwrap().failures[0]
        .message
        .contains("已变化"));
    state.db.lock().unwrap().temporary_projects[0].status = "kept".into();
    assert!(delete(&state, &[chosen], &[]).unwrap().failures[0]
        .message
        .contains("已保留"));
    assert!(Path::new(&p.path).join("new-file").exists());
}

#[test]
fn rejects_forged_ids_traversal_and_protected_items_without_deletion() {
    let (_dir, state) = fixture();
    fs::write(state.dir.join("secret.json"), "keep").unwrap();
    for id in [
        "project:../../secret.json",
        "work:../secret.json",
        "work:/tmp",
        "protected:secret.json",
        "project:00000000-0000-0000-0000-000000000000",
    ] {
        let result = delete(
            &state,
            &[Selection {
                id: id.into(),
                revision: "anything".into(),
            }],
            &[],
        )
        .unwrap();
        assert_eq!(result.failures.len(), 1);
    }
    assert_eq!(
        fs::read_to_string(state.dir.join("secret.json")).unwrap(),
        "keep"
    );
    assert!(delete(&state, &[], &[]).is_err());
    let duplicate = Selection {
        id: "x".into(),
        revision: "x".into(),
    };
    assert!(delete(&state, &[duplicate.clone(), duplicate], &[]).is_err());
}

#[test]
fn failures_are_per_item_and_success_can_be_rescanned() {
    let (_dir, state) = fixture();
    let a = project(&state, false);
    let b = project(&state, false);
    let choices = [
        selection(&state, &format!("project:{}", a.id)),
        selection(&state, &format!("project:{}", b.id)),
    ];
    fs::remove_file(Path::new(&b.path).join(".oiagent-project")).unwrap();
    let result = delete(&state, &choices, &[]).unwrap();
    assert_eq!(result.deleted_items.len(), 1);
    assert_eq!(result.failures.len(), 1);
    assert!(!Path::new(&a.path).exists());
    assert!(Path::new(&b.path).exists());
    assert!(scan(&state, &[])
        .unwrap()
        .items
        .iter()
        .all(|i| i.id != choices[0].id));
}

#[test]
fn persistence_failure_preserves_project_files() {
    let (_dir, state) = fixture();
    let p = project(&state, false);
    let chosen = selection(&state, &format!("project:{}", p.id));
    fs::create_dir(state.dir.join("state.json.tmp")).unwrap();
    assert_eq!(delete(&state, &[chosen], &[]).unwrap().failures.len(), 1);
    assert!(Path::new(&p.path).exists());
    assert_eq!(
        state.db.lock().unwrap().temporary_projects[0].status,
        "active"
    );
}

#[test]
fn stage_verification_does_not_hold_database_and_rechecks_late_state_changes() {
    let (_dir, state) = fixture();
    let p = project(&state, false);
    let result = temporary_projects::stage_checked(&state, &p.id, |_, _| {
        let mut db = state
            .db
            .try_lock()
            .expect("storage traversal must not block task reads");
        db.temporary_projects[0].status = "kept".into();
        Ok(())
    });
    assert!(result.is_err());
    assert!(Path::new(&p.path).exists());
}

#[test]
fn matching_size_does_not_allow_replaced_files_to_use_an_old_confirmation() {
    let (_dir, state) = fixture();
    let p = project(&state, false);
    let path = Path::new(&p.path).join("result");
    fs::write(&path, "old").unwrap();
    let chosen = selection(&state, &format!("project:{}", p.id));
    let modified = fs::metadata(&path).unwrap().modified().unwrap();
    let replacement = Path::new(&p.path).join("replacement");
    fs::write(&replacement, "new").unwrap();
    fs::rename(&replacement, &path).unwrap();
    fs::File::open(&path)
        .unwrap()
        .set_modified(modified)
        .unwrap();
    assert_eq!(delete(&state, &[chosen], &[]).unwrap().failures.len(), 1);
    assert_eq!(fs::read_to_string(&path).unwrap(), "new");
}

#[test]
fn retries_owned_trash_even_when_previous_deletion_removed_marker() {
    let (_dir, state) = fixture();
    let p = project(&state, false);
    let trash = temporary_projects::stage_checked(&state, &p.id, |_, _| Ok(())).unwrap();
    fs::remove_file(trash.join(".oiagent-project")).unwrap();
    fs::write(trash.join("remaining"), "left over").unwrap();
    let result = delete(
        &state,
        &[selection(&state, &format!("project:{}", p.id))],
        &[],
    )
    .unwrap();
    assert!(result.failures.is_empty());
    assert!(!trash.exists());
}

#[test]
fn stale_work_requires_marker_age_and_released_usage_lock() {
    let (_dir, state) = fixture();
    let active = files::create_work(&state.dir).unwrap();
    fs::File::open(active.path().join(files::WORK_MARKER))
        .unwrap()
        .set_modified(SystemTime::now() - StdDuration::from_secs(48 * 3600))
        .unwrap();
    assert!(files::work_lease(&state.dir, active.path()).is_err());
    let stale = stale_work(&state, "oiagent-stale");
    let unknown = state.dir.join("ai-work/unknown");
    fs::create_dir(&unknown).unwrap();
    fs::write(unknown.join("keep"), "keep").unwrap();
    let chosen = selection(&state, "work:oiagent-stale");
    assert!(delete(&state, &[chosen], &[]).unwrap().failures.is_empty());
    assert!(!stale.exists());
    files::cleanup_stale_work(&state.dir);
    assert!(active.path().exists());
    assert!(unknown.join("keep").exists());
    let stale = stale_work(&state, "oiagent-startup");
    files::cleanup_stale_work(&state.dir);
    assert!(!stale.exists());
}

#[cfg(unix)]
#[test]
fn linked_roots_markers_and_log_parents_never_delete_external_data() {
    use std::os::unix::fs::symlink;
    let (_dir, state) = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("t.jsonl"), "keep").unwrap();
    let p = project(&state, true);
    state
        .db
        .lock()
        .unwrap()
        .tasks
        .push(task("t", &p.path, "completed"));
    let chosen = selection(&state, &format!("project:{}", p.id));
    fs::remove_dir(state.dir.join("logs")).unwrap();
    symlink(outside.path(), state.dir.join("logs")).unwrap();
    assert_eq!(delete(&state, &[chosen], &[]).unwrap().failures.len(), 1);
    assert!(remove_task_files(&state, "t").is_err());
    assert_eq!(
        fs::read_to_string(outside.path().join("t.jsonl")).unwrap(),
        "keep"
    );
    fs::remove_file(state.dir.join("logs")).unwrap();
    fs::create_dir(state.dir.join("logs")).unwrap();
    fs::remove_file(Path::new(&p.path).join(".oiagent-project")).unwrap();
    fs::write(outside.path().join("marker"), &p.id).unwrap();
    symlink(
        outside.path().join("marker"),
        Path::new(&p.path).join(".oiagent-project"),
    )
    .unwrap();
    let chosen = selection(&state, &format!("protected:{}", p.path));
    assert_eq!(delete(&state, &[chosen], &[]).unwrap().failures.len(), 1);
    let ai = state.dir.join("ai-work");
    symlink(outside.path(), &ai).unwrap();
    files::cleanup_stale_work(&state.dir);
    assert!(files::create_work(&state.dir).is_err());
    assert_eq!(
        fs::read_to_string(outside.path().join("t.jsonl")).unwrap(),
        "keep"
    );
}

#[cfg(unix)]
#[test]
fn nested_symlinks_are_not_counted_or_followed_during_removal() {
    let (_dir, state) = fixture();
    let outside = tempfile::tempdir().unwrap();
    fs::write(outside.path().join("keep"), vec![1; 4096]).unwrap();
    let p = project(&state, false);
    std::os::unix::fs::symlink(outside.path(), Path::new(&p.path).join("link")).unwrap();
    let selected = selection(&state, &format!("project:{}", p.id));
    assert!(delete(&state, &[selected], &[])
        .unwrap()
        .failures
        .is_empty());
    assert_eq!(
        fs::metadata(outside.path().join("keep")).unwrap().len(),
        4096
    );
}

#[test]
fn retention_migration_extends_old_deadlines_once_and_survives_restart() {
    let (_dir, state) = fixture();
    let p = project(&state, false);
    let old_deadline = Utc::now() - Duration::days(2);
    {
        let mut db = state.db.lock().unwrap();
        db.temporary_retention_days = 0;
        db.temporary_projects[0].cleanup_after = Some(old_deadline.to_rfc3339());
        state.save(&db).unwrap();
    }
    let state = AppState::load(state.dir.clone()).unwrap();
    temporary_projects::startup(&state).unwrap();
    assert!(Path::new(&p.path).exists());
    let expected = (old_deadline + Duration::days(23)).to_rfc3339();
    assert_eq!(
        state.db.lock().unwrap().temporary_projects[0]
            .cleanup_after
            .as_deref(),
        Some(expected.as_str())
    );
    let state = AppState::load(state.dir.clone()).unwrap();
    temporary_projects::startup(&state).unwrap();
    assert_eq!(
        state.db.lock().unwrap().temporary_projects[0]
            .cleanup_after
            .as_deref(),
        Some(expected.as_str())
    );
}

#[test]
fn thirty_day_boundary_archives_restore_and_queued_work_are_safe() {
    let (_dir, state) = fixture();
    let a = project(&state, false);
    let b = project(&state, false);
    let at = Utc::now();
    {
        let mut db = state.db.lock().unwrap();
        for (index, age) in [29, 31].into_iter().enumerate() {
            db.temporary_projects[index].created_at = (at - Duration::days(age)).to_rfc3339();
            db.temporary_projects[index].cleanup_after = None;
        }
        temporary_projects::update_expiry(&mut db, at);
    }
    temporary_projects::startup(&state).unwrap();
    assert!(Path::new(&a.path).exists());
    assert!(!Path::new(&b.path).exists());
    let mut db = state.db.lock().unwrap();
    db.tasks.push(task("parent", &a.path, "completed"));
    db.archived.push("parent".into());
    db.temporary_projects[0].cleanup_after = None;
    temporary_projects::update_expiry(&mut db, at);
    assert_eq!(
        db.temporary_projects[0].cleanup_after,
        Some((at + Duration::days(30)).to_rfc3339())
    );
    temporary_projects::restore_group(&mut db, "parent");
    temporary_projects::update_expiry(&mut db, at);
    assert!(db.temporary_projects[0].cleanup_after.is_none());
    db.archived.push("parent".into());
    db.tasks[0].status = "queued".into();
    temporary_projects::update_expiry(&mut db, at);
    assert!(db.temporary_projects[0].cleanup_after.is_none());
}
