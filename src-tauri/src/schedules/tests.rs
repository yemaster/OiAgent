use super::*;
fn time(s: &str) -> DateTime<Utc> {
    s.parse().unwrap()
}
fn database() -> Database {
    let mut db = Database::default();
    db.schedules.push(Schedule {
        definition: Definition {
            id: "schedule".into(),
            revision: 1,
            name: "Check".into(),
            project: "/repo".into(),
            target: Target::Agent {
                agent_id: "codex".into(),
                prompt: "Check".into(),
                permission: "read-only".into(),
                model: String::new(),
                provider_id: None,
            },
            rule: Rule::Interval { minutes: 5 },
            enabled: true,
            catch_up: false,
        },
        next_run_at: Some("2026-10-25T00:00:00Z".into()),
        runs: vec![],
    });
    db
}
#[test]
fn claim_consumes_slot_before_launch_and_cannot_duplicate() {
    let mut db = database();
    let now = time("2026-10-25T00:00:00Z");
    assert!(claim(&mut db, "schedule", now, false).unwrap().is_some());
    assert!(claim(&mut db, "schedule", now, false).unwrap().is_none());
    assert!(claim(&mut db, "schedule", now, true).is_err());
    assert_eq!(db.schedules[0].runs.len(), 1);
}
#[test]
fn skips_missed_occurrences_or_coalesces_only_once() {
    let mut db = database();
    let now = time("2026-10-25T03:02:00Z");
    assert!(claim(&mut db, "schedule", now, false).unwrap().is_none());
    assert_eq!(db.schedules[0].runs[0].status, "skipped");
    assert_eq!(
        db.schedules[0].next_run_at,
        Some("2026-10-25T03:05:00+00:00".into())
    );
    let mut db = database();
    db.schedules[0].definition.catch_up = true;
    assert!(claim(&mut db, "schedule", now, false).unwrap().is_some());
    assert!(claim(&mut db, "schedule", now, false).unwrap().is_none());
}
#[test]
fn waiting_or_stopping_prevents_overlapping_and_manual_does_not_shift_schedule() {
    for status in ["starting", "queued", "running", "waiting", "stopping"] {
        let mut db = database();
        claim(&mut db, "schedule", time("2026-10-24T23:59:00Z"), true).unwrap();
        assert_eq!(
            db.schedules[0].next_run_at,
            Some("2026-10-25T00:00:00Z".into())
        );
        db.schedules[0].runs[0].status = status.into();
        assert!(
            claim(&mut db, "schedule", time("2026-10-25T00:00:00Z"), false)
                .unwrap()
                .is_none()
        );
        assert_eq!(db.schedules[0].runs[0].message, "上一轮尚未结束");
    }
}
#[test]
fn one_shot_disables_itself_and_paused_does_not_fire() {
    let mut db = database();
    db.schedules[0].definition.enabled = false;
    let now = time("2026-10-25T00:00:00Z");
    assert!(claim(&mut db, "schedule", now, false).unwrap().is_none());
    db.schedules[0].definition.enabled = true;
    db.schedules[0].definition.rule = Rule::Once {
        at: now.to_rfc3339(),
    };
    claim(&mut db, "schedule", now, false).unwrap();
    assert!(!db.schedules[0].definition.enabled);
    assert!(db.schedules[0].next_run_at.is_none());
}
#[test]
fn crash_after_claim_does_not_replay_and_history_is_bounded() {
    let mut db = database();
    let now = time("2026-10-25T00:00:00Z");
    claim(&mut db, "schedule", now, false).unwrap();
    recover(&mut db);
    assert_eq!(db.schedules[0].runs[0].status, "interrupted");
    assert!(claim(&mut db, "schedule", now, false).unwrap().is_none());
    for i in 1..100 {
        claim(
            &mut db,
            "schedule",
            now + chrono::Duration::minutes(i * 5),
            false,
        )
        .unwrap();
    }
    assert!(db.schedules[0].runs.len() <= 51);
    assert_eq!(
        db.schedules[0]
            .runs
            .iter()
            .filter(|r| active(&r.status))
            .count(),
        1
    );
}
#[test]
fn old_databases_default_to_no_schedules() {
    let mut value = serde_json::to_value(Database::default()).unwrap();
    value.as_object_mut().unwrap().remove("schedules");
    let db: Database = serde_json::from_value(value).unwrap();
    assert!(db.schedules.is_empty());
}

#[cfg(unix)]
mod integration {
    use super::*;
    use std::time::{Duration, Instant};
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
    fn fixture() -> (tauri::App<MockRuntime>, tempfile::TempDir) {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let root = dunce::canonicalize(dir.path()).unwrap();
        let executable = root.join("agent");
        std::fs::write(
            &executable,
            "#!/bin/sh\nprintf x >> executions\necho done\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let state = AppState::load(root.clone()).unwrap();
        let mut db = database();
        db.agents.push(crate::models::Agent {
            id: "codex".into(),
            name: "Fixture".into(),
            kind: "custom".into(),
            executable: executable.to_string_lossy().into(),
            args: vec![],
            available: true,
            version: String::new(),
            version_error: None,
            custom: true,
        });
        db.schedules[0].definition.project = root.to_string_lossy().into();
        db.schedules[0].next_run_at = Some(Utc::now().to_rfc3339());
        state.save(&db).unwrap();
        *state.db.lock().unwrap() = db;
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        app.manage(state);
        (app, dir)
    }
    fn settle(app: &tauri::App<MockRuntime>) {
        let start = Instant::now();
        loop {
            let state = app.state::<AppState>();
            if state.children.lock().unwrap().is_empty()
                && state
                    .db
                    .lock()
                    .unwrap()
                    .tasks
                    .iter()
                    .all(|t| !active(&t.status))
            {
                break;
            }
            assert!(start.elapsed() < Duration::from_secs(10));
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    #[test]
    fn persists_claim_launches_once_and_connects_result_to_history() {
        let (app, _dir) = fixture();
        tick(app.handle()).unwrap();
        settle(&app);
        tick(app.handle()).unwrap();
        let state = app.state::<AppState>();
        let db = state.db.lock().unwrap();
        let run = &db.schedules[0].runs[0];
        assert_eq!(run.status, "completed");
        assert_eq!(run.task_id.as_deref(), Some(db.tasks[0].id.as_str()));
        assert_eq!(std::fs::read(state.dir.join("executions")).unwrap(), b"x");
        assert_eq!(db.tasks.len(), 1);
        let disk: Database =
            serde_json::from_slice(&std::fs::read(state.dir.join("state.json")).unwrap()).unwrap();
        assert_eq!(disk.schedules[0].runs[0].status, "completed");
    }
    #[test]
    fn failed_persistence_never_launches_and_retry_is_safe() {
        let (app, _dir) = fixture();
        let state = app.state::<AppState>();
        std::fs::create_dir(state.dir.join("state.json.tmp")).unwrap();
        assert!(tick(app.handle()).is_err());
        assert!(state.db.lock().unwrap().schedules[0].runs.is_empty());
        assert!(!state.dir.join("executions").exists());
        std::fs::remove_dir(state.dir.join("state.json.tmp")).unwrap();
        tick(app.handle()).unwrap();
        settle(&app);
        assert_eq!(std::fs::read(state.dir.join("executions")).unwrap(), b"x");
    }
    #[test]
    fn restarted_claim_and_queued_task_never_replay() {
        let (app, _dir) = fixture();
        let state = app.state::<AppState>();
        let claimed = transaction(&state, |db| claim(db, "schedule", Utc::now(), false))
            .unwrap()
            .unwrap();
        let task = runtime::create_scheduled(
            &state,
            TaskInput {
                title: "Check".into(),
                prompt: "Check".into(),
                project: state.dir.to_string_lossy().into(),
                agent_id: "codex".into(),
                permission: "read-only".into(),
                model: String::new(),
                provider_id: None,
                attachments: vec![],
                extra_args: vec![],
                env: Default::default(),
                queued: false,
                resume_session: None,
            },
            claimed.run_id,
        )
        .unwrap();
        let loaded = AppState::load(state.dir.clone()).unwrap();
        let mut db = loaded.db.lock().unwrap();
        assert_eq!(
            db.tasks.iter().find(|t| t.id == task.id).unwrap().status,
            "interrupted"
        );
        assert_eq!(db.schedules[0].runs[0].status, "interrupted");
        assert!(claim(&mut db, "schedule", Utc::now(), false)
            .unwrap()
            .is_none());
        assert!(!state.dir.join("executions").exists());
    }
    #[test]
    fn missing_agent_is_a_visible_failed_run_without_a_broken_task_link() {
        let (app, _dir) = fixture();
        app.state::<AppState>().db.lock().unwrap().agents.clear();
        tick(app.handle()).unwrap();
        let state = app.state::<AppState>();
        let db = state.db.lock().unwrap();
        let run = &db.schedules[0].runs[0];
        assert_eq!(run.status, "failed");
        assert!(run.message.contains("Agent"));
        assert!(run.task_id.is_none());
        assert!(db.tasks.is_empty());
    }
    #[test]
    fn due_batch_is_claimed_together_without_artificially_missing_later_slots() {
        let (app, _dir) = fixture();
        let state = app.state::<AppState>();
        {
            let mut db = state.db.lock().unwrap();
            db.agents.clear();
            let original = db.schedules[0].clone();
            for i in 1..12 {
                let mut scheduled = original.clone();
                scheduled.definition.id = format!("schedule-{i}");
                db.schedules.push(scheduled);
            }
        }
        tick(app.handle()).unwrap();
        let db = state.db.lock().unwrap();
        assert!(db
            .schedules
            .iter()
            .all(|s| s.runs.len() == 1 && s.runs[0].status == "failed"));
    }
    #[test]
    fn workflow_target_uses_existing_approval_flow_and_blocks_overlap() {
        let (app, _dir) = fixture();
        let state = app.state::<AppState>();
        {
            let mut db = state.db.lock().unwrap();
            let workflow = serde_json::from_value(serde_json::json!({
                "id": "flow", "revision": 1, "name": "Confirm", "goal": "Wait for approval",
                "steps": [{ "id": "confirm", "title": "Confirm", "kind": "approval", "prompt": "Review before continuing" }]
            })).unwrap();
            db.workflow_definitions.push(workflow);
            db.schedules[0].definition.target = Target::Workflow {
                workflow_id: "flow".into(),
            };
        }
        tick(app.handle()).unwrap();
        let start = Instant::now();
        let (id, revision) = loop {
            let db = state.db.lock().unwrap();
            let run = &db.workflow_runs[0];
            if run.status == "waiting" {
                break (run.id.clone(), run.revision);
            }
            assert!(start.elapsed() < Duration::from_secs(5));
            drop(db);
            std::thread::sleep(Duration::from_millis(20));
        };
        {
            let mut db = state.db.lock().unwrap();
            assert_eq!(
                db.schedules[0].runs[0].task_id.as_deref(),
                Some(id.as_str())
            );
            db.schedules[0].next_run_at = Some(Utc::now().to_rfc3339());
        }
        tick(app.handle()).unwrap();
        {
            let db = state.db.lock().unwrap();
            assert_eq!(db.workflow_runs.len(), 1);
            assert_eq!(db.schedules[0].runs[0].message, "上一轮尚未结束");
        }
        crate::workflows::control(app.handle(), &id, "cancel", revision, "").unwrap();
    }
    #[test]
    fn shutdown_prevents_dispatch() {
        let (app, _dir) = fixture();
        let state = app.state::<AppState>();
        state.shutting_down.store(true, Ordering::Release);
        tick(app.handle()).unwrap();
        assert!(state.db.lock().unwrap().schedules[0].runs.is_empty());
    }
}
