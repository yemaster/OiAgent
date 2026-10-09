use super::*;
use std::{
    io::{BufRead, BufReader, Read, Write},
    time::{Duration, Instant},
};
use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};
fn fixture(script: &str) -> (tauri::App<MockRuntime>, tempfile::TempDir) {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().canonicalize().unwrap();
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let state = AppState::load(path.clone()).unwrap();
    let executable = path.join("fixture-agent");
    std::fs::write(&executable, format!("#!/bin/sh\n{script}\n")).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    state.db.lock().unwrap().agents.push(Agent {
        id: "fixture".into(),
        name: "Fixture".into(),
        kind: "codex".into(),
        executable: executable.to_string_lossy().into(),
        args: vec![],
        available: true,
        version: "".into(),
        custom: false,
    });
    app.manage(state);
    (app, tmp)
}
fn success() -> &'static str {
    "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Fixture evidence collected\"}}'"
}
fn step(kind: &str) -> Step {
    Step {
        id: uuid::Uuid::new_v4().to_string(),
        title: kind.into(),
        kind: kind.into(),
        prompt: "Check the fixture".into(),
        agent_id: "fixture".into(),
        permission: "read-only".into(),
        model: "".into(),
        provider_id: None,
        execution_timeout_minutes: None,
        max_repairs: 0,
    }
}
fn definition(steps: Vec<Step>) -> Definition {
    Definition {
        id: "".into(),
        revision: 0,
        name: "Fixture workflow".into(),
        goal: "Verify fixture".into(),
        steps,
    }
}
fn launch(app: &tauri::App<MockRuntime>, definition: Definition) -> String {
    start(
        app.handle().clone(),
        definition,
        app.state::<AppState>().dir.to_string_lossy().into(),
    )
    .unwrap()
    .id
}
fn settled(app: &tauri::App<MockRuntime>, id: &str) -> Run {
    let start = Instant::now();
    loop {
        let state = app.state::<AppState>();
        let run = get(&state, id).unwrap();
        if run.status != "running" && !state.workflow_workers.lock().unwrap().contains(id) {
            return run;
        }
        assert!(
            start.elapsed() < Duration::from_secs(12),
            "workflow timed out: {}",
            run.error
        );
        std::thread::sleep(Duration::from_millis(20));
    }
}
#[test]
fn approval_resumes_without_repeating_completed_steps_and_preserves_context() {
    let (app, _tmp) = fixture(success());
    let id = launch(
        &app,
        definition(vec![step("agent"), step("approval"), step("agent")]),
    );
    let waiting = settled(&app, &id);
    assert_eq!(waiting.cursor, 1);
    assert_eq!(waiting.steps[1].status, "approval");
    let state = app.state::<AppState>();
    assert_eq!(state.db.lock().unwrap().tasks.len(), 2);
    assert!(control(app.handle(), &id, "resume", waiting.revision, "").is_err());
    control(
        app.handle(),
        &id,
        "approve",
        waiting.revision,
        "Keep changes minimal",
    )
    .unwrap();
    assert!(control(app.handle(), &id, "approve", waiting.revision, "").is_err());
    let done = settled(&app, &id);
    assert_eq!(done.status, "completed");
    assert_eq!(done.steps[0].attempts, 1);
    let db = state.db.lock().unwrap();
    assert_eq!(db.tasks.len(), 3);
    assert!(db.tasks[2].prompt.contains("Fixture evidence collected"));
    assert!(db.tasks[2].prompt.contains("Keep changes minimal"));
}
#[test]
fn cancellation_does_not_start_later_steps_or_resurrect_the_run() {
    let (app, _tmp) = fixture(&format!("sleep 1\n{}", success()));
    let id = launch(&app, definition(vec![step("agent"), step("agent")]));
    let state = app.state::<AppState>();
    let start = Instant::now();
    loop {
        if state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .any(|t| t.parent_id.as_deref() == Some(&id) && t.status == "running")
        {
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(20));
    }
    let current = get(&state, &id).unwrap();
    control(app.handle(), &id, "cancel", current.revision, "").unwrap();
    let stopped = settled(&app, &id);
    assert_eq!(stopped.status, "cancelled");
    assert_eq!(stopped.steps[1].attempts, 0);
    assert_eq!(state.db.lock().unwrap().tasks.len(), 2);
}
#[test]
fn restart_recovers_completed_outputs_and_requires_manual_retry_for_unknown_effects() {
    let (app, _tmp) = fixture(success());
    let id = launch(&app, definition(vec![step("agent"), step("approval")]));
    settled(&app, &id);
    let state = app.state::<AppState>();
    {
        let mut db = state.db.lock().unwrap();
        let run = &mut db.workflow_runs[0];
        run.status = "running".into();
        run.cursor = 0;
        run.steps[0].status = "running".into();
        run.steps[0].output.clear();
        state.save(&db).unwrap();
    }
    let restored = AppState::load(state.dir.clone()).unwrap();
    let run = get(&restored, &id).unwrap();
    assert_eq!(run.status, "waiting");
    assert_eq!(run.cursor, 1);
    assert!(run.steps[0].output.contains("Fixture evidence"));
    {
        let mut db = state.db.lock().unwrap();
        db.tasks[1].status = "running".into();
        state.save(&db).unwrap();
    }
    let restored = AppState::load(state.dir.clone()).unwrap();
    let run = get(&restored, &id).unwrap();
    assert_eq!(run.cursor, 0);
    assert_eq!(run.steps[0].status, "failed");
}
#[test]
fn validates_limits_permissions_and_review_repair_targets() {
    let (app, _tmp) = fixture(success());
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    assert!(validate(&definition(vec![]), &db, true).is_err());
    let mut agent = step("agent");
    agent.permission = "danger-full-access".into();
    assert!(validate(&definition(vec![agent]), &db, true).is_err());
    let mut review = step("review");
    review.max_repairs = 1;
    assert!(validate(
        &definition(vec![step("approval"), review.clone()]),
        &db,
        true
    )
    .is_err());
    assert!(validate(&definition(vec![step("agent"), review]), &db, true).is_ok());
}
#[test]
fn review_repairs_are_bounded_and_keep_attempt_history() {
    let (app, _tmp) = fixture(success());
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    listener.set_nonblocking(true).unwrap();
    let server = std::thread::spawn(move || {
        for _ in 0..2 {
            let started = Instant::now();
            let mut socket = loop {
                if let Ok((socket, _)) = listener.accept() {
                    break socket;
                }
                assert!(started.elapsed() < Duration::from_secs(10));
                std::thread::sleep(Duration::from_millis(10));
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut len = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if line.to_lowercase().starts_with("content-length:") {
                    len = line
                        .split(':')
                        .nth(1)
                        .unwrap()
                        .trim()
                        .parse::<usize>()
                        .unwrap();
                }
            }
            let mut request = vec![0; len];
            reader.read_exact(&mut request).unwrap();
            assert!(String::from_utf8_lossy(&request).contains("Fixture evidence"));
            let body = serde_json::json!({"choices":[{"message":{"content":"{\"passed\":false,\"summary\":\"Need more evidence\"}"}}],"usage":{"prompt_tokens":20,"completion_tokens":5}}).to_string();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
        }
    });
    let state = app.state::<AppState>();
    *state.llm.lock().unwrap() = crate::llm_settings::LlmSettings::session(supervisor::LlmConfig {
        base_url: format!("http://{address}/v1"),
        model: "fixture".into(),
        api_key: "".into(),
    });
    let mut review = step("review");
    review.max_repairs = 1;
    let id = launch(&app, definition(vec![step("agent"), review]));
    let waiting = settled(&app, &id);
    assert_eq!(waiting.status, "waiting");
    assert_eq!(waiting.steps[0].attempts, 2);
    assert_eq!(waiting.steps[0].task_ids.len(), 2);
    assert_eq!(waiting.steps[1].repairs, 1);
    assert_eq!(waiting.steps[1].status, "failed");
    assert_eq!(waiting.llm_usage.input, 40);
    assert!(state
        .db
        .lock()
        .unwrap()
        .tasks
        .last()
        .unwrap()
        .prompt
        .contains("Need more evidence"));
    server.join().unwrap();
}

#[test]
fn pause_finishes_current_step_then_resume_skips_completed_work() {
    let (app, _tmp) = fixture(&format!("sleep 0.3\n{}", success()));
    let id = launch(&app, definition(vec![step("agent"), step("agent")]));
    let state = app.state::<AppState>();
    let started = Instant::now();
    loop {
        if get(&state, &id).unwrap().steps[0].status == "running" {
            break;
        }
        assert!(started.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(10));
    }
    // Pause accepts a slightly stale revision: it never authorizes more work.
    control(app.handle(), &id, "pause", 1, "").unwrap();
    let paused = settled(&app, &id);
    assert_eq!(paused.cursor, 1);
    assert_eq!(paused.steps[0].status, "completed");
    assert_eq!(paused.steps[1].attempts, 0);
    control(app.handle(), &id, "resume", paused.revision, "").unwrap();
    let done = settled(&app, &id);
    assert_eq!(done.status, "completed");
    assert_eq!(done.steps[0].attempts, 1);
}

#[test]
fn failed_process_can_be_retried_without_losing_attempts() {
    let (app, _tmp) = fixture(&format!(
        "if [ ! -f retry-marker ]; then touch retry-marker; exit 1; fi\n{}",
        success()
    ));
    let id = launch(&app, definition(vec![step("agent")]));
    let failed = settled(&app, &id);
    assert_eq!(failed.status, "waiting");
    assert_eq!(failed.steps[0].status, "failed");
    {
        let state = app.state::<AppState>();
        state.db.lock().unwrap().tasks[1].status = "running".into();
        assert!(control(app.handle(), &id, "retry", failed.revision, "")
            .unwrap_err()
            .contains("仍在运行"));
        state.db.lock().unwrap().tasks[1].status = "failed".into();
    }
    control(app.handle(), &id, "retry", failed.revision, "Retry fixture").unwrap();
    let done = settled(&app, &id);
    assert_eq!(done.status, "completed");
    assert_eq!(done.steps[0].task_ids.len(), 2);
    assert_eq!(done.steps[0].attempts, 2);
}

#[test]
fn generated_plan_keeps_user_goal_and_rejects_unavailable_or_unsafe_steps() {
    let (app, _tmp) = fixture(success());
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    let mut plan = serde_json::json!({
        "name":"模型名称", "goal":"model must not replace the user's goal",
        "id":"existing-id", "revision":999,
        "steps":[
            {"id":"inspect", "title":"检查", "kind":"agent", "prompt":"检查已有实现并报告结果", "agentId":"fixture", "permission":"read-only", "model":"invented-model", "providerId":"secret-provider", "executionTimeoutMinutes":30, "maxRepairs":2},
            {"id":"review", "title":"核对", "kind":"review", "prompt":"按目标核对报告中的证据", "maxRepairs":2}
        ]
    });
    let decoded = prompts::decode(
        &format!("```json\n{plan}\n```"),
        "仅检查，不修改",
        "我的名称",
        &db,
    )
    .unwrap();
    assert_eq!(decoded.goal, "仅检查，不修改");
    assert_eq!(decoded.name, "我的名称");
    assert!(decoded
        .steps
        .iter()
        .all(|step| step.execution_timeout_minutes.is_none()));
    assert!(decoded.id.is_empty());
    assert_eq!(decoded.revision, 0);
    assert!(decoded
        .steps
        .iter()
        .all(|s| s.max_repairs == 0 && s.provider_id.is_none() && s.model.is_empty()));
    assert!(db.tasks.is_empty());
    plan["steps"][0]["agentId"] = serde_json::json!("uninstalled");
    assert!(prompts::decode(&plan.to_string(), "goal", "", &db)
        .unwrap_err()
        .contains("不可用"));
    plan["steps"][0]["agentId"] = serde_json::json!("fixture");
    plan["steps"][0]["permission"] = serde_json::json!("full-access");
    assert!(prompts::decode(&plan.to_string(), "goal", "", &db)
        .unwrap_err()
        .contains("权限"));
    plan["steps"][0]["permission"] = serde_json::json!("read-only");
    plan["steps"][1]["kind"] = serde_json::json!("parallel");
    assert!(prompts::decode(&plan.to_string(), "goal", "", &db)
        .unwrap_err()
        .contains("类型"));
    plan["steps"] = serde_json::json!([]);
    assert!(prompts::decode(&plan.to_string(), "goal", "", &db)
        .unwrap_err()
        .contains("2–12"));
}

#[test]
fn legacy_step_timeouts_are_ignored_and_removed_on_save() {
    let (app, _tmp) = fixture(success());
    let mut value = serde_json::to_value(definition(vec![step("agent")])).unwrap();
    // Even a previously invalid zero-minute limit no longer controls dispatch.
    value["steps"][0]["timeoutMinutes"] = serde_json::json!(0);
    let loaded: Definition = serde_json::from_value(value).unwrap();
    assert!(serde_json::to_value(&loaded).unwrap()["steps"][0]
        .get("timeoutMinutes")
        .is_none());
    let id = launch(&app, loaded);
    assert_eq!(settled(&app, &id).status, "completed");
}

#[test]
fn execution_limits_are_opt_in_and_use_the_user_selected_duration() {
    assert!(!engine::execution_limit_reached(
        None,
        Duration::from_secs(86400)
    ));
    assert!(!engine::execution_limit_reached(
        Some(60),
        Duration::from_secs(1801)
    ));
    assert!(!engine::execution_limit_reached(
        Some(30),
        Duration::from_secs(1799)
    ));
    assert!(engine::execution_limit_reached(
        Some(30),
        Duration::from_secs(1800)
    ));
    let (app, _tmp) = fixture(success());
    let state = app.state::<AppState>();
    let mut custom = definition(vec![step("agent")]);
    custom.steps[0].execution_timeout_minutes = Some(90);
    let decoded: Definition =
        serde_json::from_value(serde_json::to_value(&custom).unwrap()).unwrap();
    assert_eq!(decoded.steps[0].execution_timeout_minutes, Some(90));
    assert!(validate(&decoded, &state.db.lock().unwrap(), true).is_ok());
    custom.steps[0].execution_timeout_minutes = Some(0);
    assert!(validate(&custom, &state.db.lock().unwrap(), true).is_err());
}
