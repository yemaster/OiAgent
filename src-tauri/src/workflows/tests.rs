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
        version_error: None,
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
        position: None,
    }
}
fn definition(steps: Vec<Step>) -> Definition {
    Definition {
        id: "".into(),
        revision: 0,
        name: "Fixture workflow".into(),
        goal: "Verify fixture".into(),
        steps,
        default_agent_id: String::new(),
        edges: None,
        max_parallel: 2,
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
            socket.set_nonblocking(false).unwrap();
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

fn graph_definition(mut steps: Vec<Step>, links: &[(usize, usize, Option<&str>)]) -> Definition {
    for step in &mut steps {
        step.agent_id.clear();
    }
    let edges = links
        .iter()
        .enumerate()
        .map(|(i, (source, target, branch))| Edge {
            id: format!("edge-{i}"),
            source: steps[*source].id.clone(),
            target: steps[*target].id.clone(),
            branch: branch.map(str::to_owned),
        })
        .collect();
    Definition {
        default_agent_id: "fixture".into(),
        edges: Some(edges),
        ..definition(steps)
    }
}
fn await_run(app: &tauri::App<MockRuntime>, id: &str, predicate: impl Fn(&Run) -> bool) -> Run {
    let start = Instant::now();
    loop {
        let run = get(&app.state::<AppState>(), id).unwrap();
        if predicate(&run) {
            return run;
        }
        assert!(
            start.elapsed() < Duration::from_secs(8),
            "condition timeout: {run:?}"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn graph_parallel_roots_join_once_and_inherit_default_agent() {
    let (app, _tmp) = fixture(&format!("sleep 0.5\n{}", success()));
    // The join comes FIRST in the array: dependencies, not display order, govern execution.
    let def = graph_definition(
        vec![step("agent"), step("agent"), step("agent")],
        &[(1, 0, None), (2, 0, None)],
    );
    let id = launch(&app, def);
    let parallel = await_run(&app, &id, |r| {
        r.steps[1].status == "running" && r.steps[2].status == "running"
    });
    assert_eq!(parallel.steps[0].attempts, 0);
    let done = settled(&app, &id);
    assert_eq!(done.status, "completed");
    assert!(done.steps.iter().all(|s| s.attempts == 1));
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    let join = db
        .tasks
        .iter()
        .find(|t| done.steps[0].task_ids.contains(&t.id))
        .unwrap();
    assert_eq!(join.agent_id, "fixture");
    assert_eq!(join.prompt.matches("Fixture evidence collected").count(), 2);
}
#[test]
fn graph_serializes_writers_and_pause_drains_parallel_work() {
    let (app, _tmp) = fixture(&format!("sleep 0.5\n{}", success()));
    let mut writer = step("agent");
    writer.permission = "workspace-write".into();
    let id = launch(&app, graph_definition(vec![step("agent"), writer], &[]));
    let first = await_run(&app, &id, |r| r.steps[0].status == "running");
    assert_eq!(first.steps[1].attempts, 0);
    control(app.handle(), &id, "pause", first.revision, "").unwrap();
    let paused = settled(&app, &id);
    assert_eq!(paused.steps[0].status, "completed");
    assert_eq!(paused.steps[1].attempts, 0);
    control(app.handle(), &id, "resume", paused.revision, "").unwrap();
    let done = settled(&app, &id);
    assert_eq!(done.status, "completed");
    assert_eq!(done.steps[0].attempts, 1);
}
#[test]
fn graph_approvals_are_addressable_and_do_not_block_independent_paths() {
    let (app, _tmp) = fixture(success());
    let def = graph_definition(
        vec![
            step("approval"),
            step("approval"),
            step("agent"),
            step("agent"),
        ],
        &[(0, 3, None), (1, 3, None), (2, 3, None)],
    );
    let id = launch(&app, def.clone());
    let waiting = settled(&app, &id);
    assert_eq!(waiting.steps[2].status, "completed");
    assert_eq!(waiting.steps[3].attempts, 0);
    graph::control(
        app.handle(),
        &id,
        "approve",
        waiting.revision,
        "Second approved",
        Some(&def.steps[1].id),
    )
    .unwrap();
    let next = settled(&app, &id);
    assert_eq!(next.steps[0].status, "approval");
    assert_eq!(next.steps[1].status, "completed");
    assert_eq!(next.steps[3].attempts, 0);
    graph::control(
        app.handle(),
        &id,
        "approve",
        next.revision,
        "First approved",
        Some(&def.steps[0].id),
    )
    .unwrap();
    let done = settled(&app, &id);
    assert_eq!(done.status, "completed");
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    let join = db
        .tasks
        .iter()
        .find(|t| done.steps[3].task_ids.contains(&t.id))
        .unwrap();
    assert!(join.prompt.contains("First approved") && join.prompt.contains("Second approved"));
}
#[test]
fn graph_cancel_stops_all_parallel_nodes_and_never_dispatches_join() {
    let (app, _tmp) = fixture(&format!("sleep 1\n{}", success()));
    let id = launch(
        &app,
        graph_definition(
            vec![step("agent"), step("agent"), step("agent")],
            &[(0, 2, None), (1, 2, None)],
        ),
    );
    let current = await_run(&app, &id, |r| {
        r.steps[0].status == "running" && r.steps[1].status == "running"
    });
    // This is also the entry used by cancellation from the ordinary task list.
    control(app.handle(), &id, "cancel", current.revision, "").unwrap();
    let done = settled(&app, &id);
    assert_eq!(done.status, "cancelled");
    assert_eq!(done.steps[2].attempts, 0);
    assert!(done.steps.iter().all(|s| s.status == "cancelled"));
}
#[test]
fn graph_recovery_handles_every_active_node_without_replaying_unknown_effects() {
    let (app, _tmp) = fixture(success());
    let id = launch(
        &app,
        graph_definition(
            vec![step("agent"), step("agent"), step("approval")],
            &[(0, 2, None), (1, 2, None)],
        ),
    );
    let waiting = settled(&app, &id);
    let state = app.state::<AppState>();
    {
        let mut db = state.db.lock().unwrap();
        let unknown = waiting.steps[1].task_ids[0].clone();
        db.tasks
            .iter_mut()
            .find(|t| t.id == unknown)
            .unwrap()
            .status = "running".into();
        let run = &mut db.workflow_runs[0];
        run.status = "running".into();
        run.steps[0].status = "running".into();
        run.steps[1].status = "running".into();
        state.save(&db).unwrap();
    }
    let recovered = AppState::load(state.dir.clone()).unwrap();
    let run = get(&recovered, &id).unwrap();
    assert_eq!(run.status, "waiting");
    assert_eq!(run.steps[0].status, "completed");
    assert_eq!(run.steps[1].status, "failed");
    assert_eq!(run.cursor, 1);
}
#[test]
fn graph_validation_rejects_cycles_invalid_branches_and_shared_repair_targets() {
    let (app, _tmp) = fixture(success());
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    let mut def = graph_definition(
        vec![step("agent"), step("agent")],
        &[(0, 1, None), (1, 0, None)],
    );
    assert!(validate(&def, &db, true).unwrap_err().contains("循环"));
    def = graph_definition(
        vec![step("condition"), step("agent"), step("agent")],
        &[(0, 1, Some("true"))],
    );
    assert!(validate(&def, &db, true).unwrap_err().contains("两个分支"));
    def = graph_definition(
        vec![step("agent"), step("review"), step("agent")],
        &[(0, 1, None), (0, 2, None)],
    );
    def.steps[1].max_repairs = 1;
    assert!(validate(&def, &db, true)
        .unwrap_err()
        .contains("不能连接其他节点"));
    def.steps[1].max_repairs = 0;
    assert!(validate(&def, &db, true).is_ok());
    def.default_agent_id = "missing".into();
    assert!(validate(&def, &db, true).unwrap_err().contains("不可用"));
    def.steps[0].agent_id = "fixture".into();
    def.steps[2].agent_id = "fixture".into();
    assert!(validate(&def, &db, true).is_ok());
}
fn decision_server(
    app: &tauri::App<MockRuntime>,
    replies: Vec<&str>,
) -> std::thread::JoinHandle<()> {
    decision_server_delayed(app, replies, Duration::ZERO)
}
fn decision_server_delayed(
    app: &tauri::App<MockRuntime>,
    replies: Vec<&str>,
    delay: Duration,
) -> std::thread::JoinHandle<()> {
    decision_http_server(
        app,
        replies.into_iter().map(|reply| (200, reply)).collect(),
        delay,
    )
}
fn decision_http_server(
    app: &tauri::App<MockRuntime>,
    replies: Vec<(u16, &str)>,
    delay: Duration,
) -> std::thread::JoinHandle<()> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    *app.state::<AppState>().llm.lock().unwrap() =
        crate::llm_settings::LlmSettings::session(supervisor::LlmConfig {
            base_url: format!("http://{address}/v1"),
            model: "fixture".into(),
            api_key: "".into(),
        });
    let replies: Vec<_> = replies
        .into_iter()
        .map(|(status, reply)| (status, reply.to_owned()))
        .collect();
    listener.set_nonblocking(true).unwrap();
    let record_dir = app.state::<AppState>().dir.clone();
    std::thread::spawn(move || {
        for (index, (status, reply)) in replies.into_iter().enumerate() {
            let start = Instant::now();
            let mut socket = loop {
                if let Ok((socket, _)) = listener.accept() {
                    break socket;
                }
                assert!(start.elapsed() < Duration::from_secs(10));
                std::thread::sleep(Duration::from_millis(10));
            };
            socket.set_nonblocking(false).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut reader = BufReader::new(socket.try_clone().unwrap());
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" {
                    break;
                }
                if line.to_lowercase().starts_with("content-length:") {
                    length = line
                        .split(':')
                        .nth(1)
                        .unwrap()
                        .trim()
                        .parse::<usize>()
                        .unwrap();
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            std::fs::write(
                record_dir.join(format!("review-request-{index}.json")),
                &body,
            )
            .unwrap();
            std::thread::sleep(delay);
            let response = serde_json::json!({"choices":[{"message":{"content":reply}}],"usage":{"prompt_tokens":20,"completion_tokens":5}}).to_string();
            write!(socket,"HTTP/1.1 {status} Response\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",response.len(),response).unwrap();
        }
    })
}
#[test]
fn graph_routes_conditions_skips_unselected_path_and_waits_for_join() {
    for passed in [true, false] {
        let (app, _tmp) = fixture(success());
        let reply = format!("{{\"passed\":{passed},\"summary\":\"Fixture condition evaluated\"}}");
        let server = decision_server(&app, vec![&reply]);
        let id = launch(
            &app,
            graph_definition(
                vec![
                    step("agent"),
                    step("condition"),
                    step("agent"),
                    step("agent"),
                    step("agent"),
                ],
                &[
                    (0, 1, None),
                    (1, 2, Some("true")),
                    (1, 3, Some("false")),
                    (2, 4, None),
                    (3, 4, None),
                ],
            ),
        );
        let done = settled(&app, &id);
        assert_eq!(done.status, "completed");
        assert_eq!(done.steps[1].branch, Some(passed));
        assert_eq!(done.steps[if passed { 3 } else { 2 }].status, "skipped");
        assert_eq!(done.steps[4].attempts, 1);
        assert_eq!(done.llm_usage.input, 20);
        server.join().unwrap();
    }
}
#[test]
fn graph_missing_condition_evidence_pauses_instead_of_guessing() {
    let (app, _tmp) = fixture(success());
    let server = decision_server(&app, vec!["{\"error\":\"Missing evidence\"}"]);
    let id = launch(
        &app,
        graph_definition(
            vec![step("condition"), step("agent"), step("agent")],
            &[(0, 1, Some("true")), (0, 2, Some("false"))],
        ),
    );
    let run = settled(&app, &id);
    assert_eq!(run.status, "waiting");
    assert_eq!(run.steps[0].status, "failed");
    assert_eq!(run.steps[1].attempts, 0);
    assert_eq!(run.steps[2].attempts, 0);
    assert_eq!(run.llm_usage.input, 20);
    server.join().unwrap();
}
#[test]
fn graph_review_repair_reexecutes_only_its_exclusive_parent() {
    let (app, _tmp) = fixture(success());
    let server = decision_server(
        &app,
        vec![
            "{\"passed\":false,\"summary\":\"Need additional evidence\"}",
            "{\"passed\":true,\"summary\":\"Evidence complete\"}",
        ],
    );
    let mut def = graph_definition(
        vec![step("agent"), step("review"), step("agent"), step("agent")],
        &[(0, 1, None), (1, 3, None), (2, 3, None)],
    );
    def.steps[1].max_repairs = 1;
    let id = launch(&app, def);
    let run = settled(&app, &id);
    assert_eq!(run.status, "completed");
    assert_eq!(run.steps[0].attempts, 2);
    assert_eq!(run.steps[1].attempts, 2);
    assert_eq!(run.steps[2].attempts, 1);
    assert_eq!(run.steps[3].attempts, 1);
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    assert!(db
        .tasks
        .iter()
        .find(|t| t.id == run.steps[0].task_ids[1])
        .unwrap()
        .prompt
        .contains("Need additional evidence"));
    server.join().unwrap();
}

#[test]
fn graph_approval_can_be_given_while_an_independent_agent_is_running() {
    let (app, _tmp) = fixture(&format!("sleep 1\n{}", success()));
    let def = graph_definition(
        vec![step("approval"), step("agent"), step("agent")],
        &[(0, 2, None)],
    );
    let id = launch(&app, def.clone());
    let current = await_run(&app, &id, |r| {
        r.steps[0].status == "approval" && r.steps[1].status == "running"
    });
    graph::control(
        app.handle(),
        &id,
        "approve",
        current.revision,
        "Continue",
        Some(&def.steps[0].id),
    )
    .unwrap();
    let parallel = await_run(&app, &id, |r| {
        r.steps[1].status == "running" && r.steps[2].status == "running"
    });
    assert_eq!(parallel.steps[0].status, "completed");
    assert_eq!(settled(&app, &id).status, "completed");
}

#[test]
fn slow_llm_does_not_block_independent_agent_dispatch() {
    let (app, _tmp) = fixture(success());
    let server = decision_server_delayed(
        &app,
        vec!["{\"passed\":true,\"summary\":\"Condition passed\"}"],
        Duration::from_secs(2),
    );
    let id = launch(
        &app,
        graph_definition(
            vec![
                step("condition"),
                step("agent"),
                step("approval"),
                step("approval"),
                step("agent"),
            ],
            &[(0, 2, Some("true")), (0, 3, Some("false")), (1, 4, None)],
        ),
    );
    let progressed = await_run(&app, &id, |r| {
        r.steps[4].status == "completed" && r.steps[0].status == "running"
    });
    assert_eq!(progressed.steps[1].attempts, 1);
    let waiting = settled(&app, &id);
    assert_eq!(waiting.steps[2].status, "approval");
    assert_eq!(waiting.steps[3].status, "skipped");
    server.join().unwrap();
}

#[test]
fn live_waiting_children_finish_before_the_workflow_advances() {
    for graph in [false, true] {
        let (app, _tmp) = fixture(&format!("sleep 1\n{}", success()));
        let steps = vec![step("agent"), step("agent")];
        let def = if graph {
            graph_definition(steps, &[(0, 1, None)])
        } else {
            definition(steps)
        };
        let id = launch(&app, def);
        let running = await_run(&app, &id, |r| !r.steps[0].task_ids.is_empty());
        let state = app.state::<AppState>();
        let child_id = running.steps[0].task_ids[0].clone();
        state
            .update(&child_id, |t| t.status = "waiting".into())
            .unwrap();
        std::thread::sleep(Duration::from_millis(400));
        let during = get(&state, &id).unwrap();
        assert_eq!(during.steps[0].status, "running");
        assert_eq!(during.steps[1].attempts, 0);
        let done = settled(&app, &id);
        assert_eq!(done.status, "completed");
        assert!(done.steps.iter().all(|s| s.attempts == 1));
    }
}

#[test]
fn exited_waiting_children_can_be_retried_and_completed_children_are_not_replayed() {
    for graph in [false, true] {
        for resolved in [false, true] {
            let (app, _tmp) = fixture("exit 1");
            let steps = vec![step("agent"), step("agent")];
            let def = if graph {
                graph_definition(steps, &[(0, 1, None)])
            } else {
                definition(steps)
            };
            let id = launch(&app, def);
            let failed = settled(&app, &id);
            let state = app.state::<AppState>();
            let child_id = &failed.steps[0].task_ids[0];
            state
                .update(child_id, |t| {
                    t.status = if resolved { "completed" } else { "waiting" }.into()
                })
                .unwrap();
            std::fs::write(
                state.dir.join("fixture-agent"),
                format!("#!/bin/sh\n{}\n", success()),
            )
            .unwrap();
            control(app.handle(), &id, "retry", failed.revision, "").unwrap();
            let done = settled(&app, &id);
            assert_eq!(done.status, "completed");
            assert_eq!(done.steps[0].attempts, if resolved { 1 } else { 2 });
            assert_eq!(done.steps[1].attempts, 1);
            assert_eq!(done.steps[0].task_ids.len(), if resolved { 1 } else { 2 });
        }
    }
}

#[test]
fn restart_preserves_waiting_parent_and_recognizes_finished_graph() {
    let (app, _tmp) = fixture(success());
    let id = launch(
        &app,
        graph_definition(vec![step("agent"), step("approval")], &[(0, 1, None)]),
    );
    let waiting = settled(&app, &id);
    let state = app.state::<AppState>();
    let restored = AppState::load(state.dir.clone()).unwrap();
    assert_eq!(get(&restored, &id).unwrap().status, "waiting");
    assert_eq!(
        restored
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.id == id)
            .unwrap()
            .status,
        "waiting"
    );
    control(app.handle(), &id, "approve", waiting.revision, "").unwrap();
    assert_eq!(settled(&app, &id).status, "completed");
    {
        let mut db = state.db.lock().unwrap();
        db.workflow_runs[0].status = "running".into();
        db.tasks.iter_mut().find(|t| t.id == id).unwrap().status = "running".into();
        state.save(&db).unwrap();
    }
    let restored = AppState::load(state.dir.clone()).unwrap();
    assert_eq!(get(&restored, &id).unwrap().status, "completed");
    assert_eq!(
        restored
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.id == id)
            .unwrap()
            .status,
        "completed"
    );
}

#[test]
fn transient_llm_failure_retries_and_continues_without_repeating_agents() {
    let (app, _tmp) = fixture(success());
    let server = decision_http_server(
        &app,
        vec![
            (503, "unavailable"),
            (200, r#"{"passed":true,"summary":"Evidence verified"}"#),
        ],
        Duration::ZERO,
    );
    let id = launch(
        &app,
        graph_definition(
            vec![step("agent"), step("review"), step("agent")],
            &[(0, 1, None), (1, 2, None)],
        ),
    );
    let done = settled(&app, &id);
    server.join().unwrap();
    assert_eq!(done.status, "completed");
    assert!(done.steps.iter().all(|s| s.attempts == 1));
    assert_eq!(done.llm_usage.input, 20);
}

#[test]
fn invalid_credentials_do_not_retry_and_cancel_during_backoff_stops_dispatch() {
    for status in [401, 503] {
        let (app, _tmp) = fixture(success());
        let server = decision_http_server(&app, vec![(status, "unavailable")], Duration::ZERO);
        let id = launch(
            &app,
            graph_definition(
                vec![step("agent"), step("review"), step("agent")],
                &[(0, 1, None), (1, 2, None)],
            ),
        );
        if status == 503 {
            let retrying = await_run(&app, &id, |r| r.steps[1].output.contains("秒后重试"));
            control(app.handle(), &id, "cancel", retrying.revision, "").unwrap();
        }
        let done = settled(&app, &id);
        server.join().unwrap();
        assert_eq!(
            done.status,
            if status == 401 {
                "waiting"
            } else {
                "cancelled"
            }
        );
        assert_eq!(done.steps[2].attempts, 0);
        if status == 401 {
            assert!(done.steps[1].output.contains("401"));
        }
    }
}

#[test]
fn llm_retries_are_bounded_and_report_the_final_error() {
    let (app, _tmp) = fixture(success());
    let server = decision_http_server(
        &app,
        vec![
            (503, "unavailable"),
            (503, "unavailable"),
            (503, "unavailable"),
        ],
        Duration::ZERO,
    );
    let config = crate::llm_settings::config(&app.state::<AppState>()).unwrap();
    let mut delays = vec![];
    let error = supervisor::request_with_retry(&config, "fixture", "fixture", |retry, delay| {
        delays.push((retry, delay.as_secs()));
        Ok(())
    })
    .unwrap_err();
    server.join().unwrap();
    assert_eq!(delays, vec![(1, 2), (2, 4)]);
    assert!(error.contains("503"));
}

#[test]
fn application_exit_keeps_incomplete_workflows_resumable() {
    let (app, _tmp) = fixture(&format!("sleep 2\n{}", success()));
    let id = launch(
        &app,
        graph_definition(
            vec![step("agent"), step("approval"), step("agent")],
            &[(0, 1, None), (1, 2, None)],
        ),
    );
    await_run(&app, &id, |run| !run.steps[0].task_ids.is_empty());
    crate::lifecycle::shutdown(app.handle());
    let stopped = settled(&app, &id);
    assert_eq!(stopped.status, "waiting");
    assert_eq!(stopped.steps[0].status, "failed");
    assert_eq!(stopped.steps[1].status, "pending");
    let restored = AppState::load(app.state::<AppState>().dir.clone()).unwrap();
    assert_eq!(get(&restored, &id).unwrap().status, "waiting");
    assert_eq!(
        restored
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.id == id)
            .unwrap()
            .status,
        "waiting"
    );
}

#[test]
fn stopped_runs_continue_native_sessions_without_repeating_completed_steps() {
    for graph_mode in [false, true] {
        let script = r#"
n=0
[ ! -f calls ] || n=$(cat calls)
n=$((n+1))
printf '%s' "$n" > calls
printf '%s\n' "$@" > "invocation-$n"
if [ "$n" = 2 ]; then
  printf '%s\n' '{"type":"thread.started","thread_id":"fixture-session"}'
  printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Partial work saved"}}'
  sleep 8
fi
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"Node finished"}}'
"#;
        let (app, _tmp) = fixture(script);
        let steps = vec![step("agent"), step("agent"), step("agent")];
        let def = if graph_mode {
            graph_definition(steps, &[(0, 1, None), (1, 2, None)])
        } else {
            definition(steps)
        };
        let id = launch(&app, def);
        let state = app.state::<AppState>();
        await_run(&app, &id, |run| {
            run.steps[0].status == "completed"
                && run.steps[1].task_ids.last().is_some_and(|id| {
                    state
                        .db
                        .lock()
                        .unwrap()
                        .tasks
                        .iter()
                        .any(|t| &t.id == id && t.session_id.as_deref() == Some("fixture-session"))
                })
        });
        let current = get(&state, &id).unwrap();
        control(app.handle(), &id, "cancel", current.revision, "").unwrap();
        let stopped = settled(&app, &id);
        let start = Instant::now();
        while !state.children.lock().unwrap().is_empty() {
            assert!(start.elapsed() < Duration::from_secs(3));
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(stopped.steps[0].status, "completed");
        control(
            app.handle(),
            &id,
            "resume",
            stopped.revision,
            "继续剩余内容",
        )
        .unwrap();
        assert!(control(app.handle(), &id, "resume", stopped.revision, "").is_err());
        let done = settled(&app, &id);
        assert_eq!(done.status, "completed");
        assert_eq!(done.steps[0].attempts, 1);
        assert_eq!(done.steps[1].attempts, 2);
        assert_eq!(done.steps[2].attempts, 1);
        assert_eq!(
            std::fs::read_to_string(state.dir.join("calls")).unwrap(),
            "4"
        );
        let resumed = std::fs::read_to_string(state.dir.join("invocation-3")).unwrap();
        assert!(resumed.contains("resume\n") && resumed.contains("fixture-session"));
        assert!(resumed.contains("继续这个中断的工作流节点") && resumed.contains("继续剩余内容"));
        assert_eq!(done.steps[1].task_ids.len(), 2);
    }
}

#[test]
fn continue_after_failure_carries_tool_context_without_a_native_session() {
    for graph_mode in [false, true] {
        let (app, _tmp) = fixture(
            r#"
if [ ! -f partial ]; then
  touch partial
  printf '%s\n' '{"type":"item.completed","item":{"type":"command_execution","id":"check","command":"git diff","aggregated_output":"saved-tool-evidence","exit_code":0}}'
  exit 1
fi
printf '%s\n' "$@" > continued-arguments
printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"continued"}}'
"#,
        );
        let steps = vec![step("agent")];
        let id = launch(
            &app,
            if graph_mode {
                graph_definition(steps, &[])
            } else {
                definition(steps)
            },
        );
        let failed = settled(&app, &id);
        control(
            app.handle(),
            &id,
            "continue",
            failed.revision,
            "保留已有修改",
        )
        .unwrap();
        let done = settled(&app, &id);
        assert_eq!(done.status, "completed");
        let state = app.state::<AppState>();
        let prompt = std::fs::read_to_string(state.dir.join("continued-arguments")).unwrap();
        assert!(prompt.contains("saved-tool-evidence"));
        assert!(prompt.contains("保留已有修改"));
        assert!(prompt.contains("继续这个中断的工作流节点"));
        assert!(!prompt.contains("resume\n"));
        assert_eq!(done.steps[0].task_ids.len(), 2);
    }
}

#[test]
fn resuming_stopped_workflow_reopens_approval_instead_of_skipping_it() {
    for graph_mode in [false, true] {
        let (app, _tmp) = fixture(success());
        let steps = vec![step("agent"), step("approval"), step("agent")];
        let id = launch(
            &app,
            if graph_mode {
                graph_definition(steps, &[(0, 1, None), (1, 2, None)])
            } else {
                definition(steps)
            },
        );
        let waiting = settled(&app, &id);
        control(app.handle(), &id, "cancel", waiting.revision, "").unwrap();
        let stopped = settled(&app, &id);
        control(app.handle(), &id, "resume", stopped.revision, "").unwrap();
        let waiting = settled(&app, &id);
        assert_eq!(waiting.steps[0].attempts, 1);
        assert_eq!(waiting.steps[1].status, "approval");
        assert_eq!(waiting.steps[2].attempts, 0);
        control(app.handle(), &id, "approve", waiting.revision, "").unwrap();
        assert_eq!(settled(&app, &id).status, "completed");
    }
}

#[test]
fn continuation_checkpoint_survives_restart_and_does_not_cross_providers() {
    let (app, _tmp) = fixture("exit 1");
    let id = launch(&app, definition(vec![step("agent")]));
    let mut run = settled(&app, &id);
    let state = app.state::<AppState>();
    let previous_id = run.steps[0].task_ids[0].clone();
    {
        let mut db = state.db.lock().unwrap();
        let task = db.tasks.iter_mut().find(|t| t.id == previous_id).unwrap();
        task.session_id = Some("private-session".into());
        task.provider_id = Some("different-provider".into());
    }
    continuation::prepare(&state, &mut run, 0).unwrap();
    engine::save_run(app.handle(), run).unwrap();
    let restored = AppState::load(state.dir.clone()).unwrap();
    let run = get(&restored, &id).unwrap();
    assert_eq!(
        run.steps[0].resume_task_id.as_deref(),
        Some(previous_id.as_str())
    );
    let child =
        continuation::create_child(&restored, &run, 0, "Finish remaining work".into()).unwrap();
    assert!(child.session_id.is_none());
    assert!(child.prompt.contains("继续这个中断的工作流节点"));
    assert_eq!(child.status, "queued");
}

#[test]
fn stopped_llm_attempt_cannot_restart_after_a_new_attempt_begins() {
    let (app, _tmp) = fixture("exit 1");
    let id = launch(&app, definition(vec![step("agent")]));
    let mut old = settled(&app, &id);
    old.status = "running".into();
    old.steps[0].status = "running".into();
    let mut current = old.clone();
    current.steps[0].attempts += 1;
    engine::save_run(app.handle(), current).unwrap();
    let error = engine::request(
        app.handle(),
        &old,
        0,
        &supervisor::LlmConfig {
            base_url: "invalid://must-not-send".into(),
            model: "fixture".into(),
            api_key: "".into(),
        },
        "Review",
        "Evidence",
    )
    .unwrap_err();
    assert_eq!(error, "工作流已停止");
}

#[test]
fn artifacts_are_shared_with_downstream_agents_and_reviewers() {
    for graph_mode in [false, true] {
        let (app, _tmp) = fixture(
            r#"
mkdir -p plans
if [ ! -f plans/analysis.md ]; then
  printf '%s' 'SOURCE-EVIDENCE: conclusion A is backed by observation B.' > plans/analysis.md
  printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"分析已写入 `plans/analysis.md`"}}'
else
  printf '%s\n' "$@" > handoff-arguments
  printf '%s' 'FINAL-DELIVERABLE: A maps to B.' > summary.md
  printf '%s\n' '{"type":"item.completed","item":{"type":"agent_message","text":"完成。\n## 最终产物\n- [报告](summary.md)"}}'
fi
"#,
        );
        let server = decision_server(
            &app,
            vec![
                r#"{"passed":true,"summary":"通过，证据和汇总匹配。可改进项：可选基准测试未执行，不影响交付。"}"#,
            ],
        );
        let steps = vec![step("agent"), step("agent"), step("review")];
        let id = launch(
            &app,
            if graph_mode {
                graph_definition(steps, &[(0, 1, None), (1, 2, None)])
            } else {
                definition(steps)
            },
        );
        let run = settled(&app, &id);
        assert_eq!(run.status, "completed", "{}", run.error);
        server.join().unwrap();
        let state = app.state::<AppState>();
        let handoff = std::fs::read_to_string(state.dir.join("handoff-arguments")).unwrap();
        assert!(handoff.contains("SOURCE-EVIDENCE"));
        let review = std::fs::read_to_string(state.dir.join("review-request-0.json")).unwrap();
        assert!(review.contains("SOURCE-EVIDENCE"));
        assert!(review.contains("FINAL-DELIVERABLE"));
        let files = artifacts::collect(&state, &run, &[0, 1]);
        assert_eq!(
            files
                .files
                .iter()
                .filter(|file| file.error.is_none())
                .count(),
            1
        );
        assert_eq!(files.files[0].relative_path, "summary.md");
        // Rechecking must read the edited file, rather than reuse the old excerpt.
        std::fs::write(state.dir.join("summary.md"), "UPDATED-DELIVERABLE").unwrap();
        let evidence = artifacts::evidence(&state, &run, &[0, 1]).to_string();
        assert!(evidence.contains("UPDATED-DELIVERABLE"));
        assert!(!evidence.contains("FINAL-DELIVERABLE"));
    }
}

#[test]
fn published_artifacts_take_priority_over_internal_evidence() {
    let (app, _tmp) = fixture(success());
    let steps = vec![step("agent"), step("agent"), step("agent")];
    let id = launch(&app, graph_definition(steps, &[(0, 2, None)]));
    let mut run = settled(&app, &id);
    let state = app.state::<AppState>();
    for step in &mut run.steps {
        step.task_ids.clear();
    }
    for path in ["draft.md", "parallel.md", "final report.md"] {
        std::fs::write(state.dir.join(path), format!("BODY-{path}")).unwrap();
    }
    for (index, path) in ["draft.md", "parallel.md", "final report.md"].iter().enumerate() {
        let id = format!("artifact-{index}");
        run.steps[index].task_ids.push(id.clone());
        let message = serde_json::json!({"role":"tool","text":"file_change","timestamp":"","tool":{
            "name":"file_change","state":"completed","input":{"changes":[{"path":path,"kind":"add"}]}
        }});
        std::fs::write(state.dir.join("logs").join(format!("{id}.messages.jsonl")), format!("{message}\n")).unwrap();
    }
    // Successful mutations remain visible even if a later step omits them.
    run.steps[0].output = "Draft `draft.md`".into();
    run.steps[1].output = "Result `parallel.md`".into();
    run.steps[2].output = "Result [report](<final report.md>)".into();
    let legacy = artifacts::collect(&state, &run, &[0, 1, 2]);
    assert!(legacy
        .files
        .iter()
        .any(|f| f.relative_path == "parallel.md"));
    assert!(legacy.files.iter().any(|f| f.relative_path == "draft.md"));

    run.steps[0].output = "## 最终产物\n无\n## 交接\n`draft.md`".into();
    run.steps[1].output = "## 最终产物\n无\n## 交接\n`parallel.md`".into();
    let noisy = (0..40)
        .map(|i| {
            let path = format!("reference-{i}.md");
            std::fs::write(state.dir.join(&path), "REFERENCE").unwrap();
            format!("`{path}`")
        })
        .collect::<Vec<_>>()
        .join("\n");
    run.steps[2].output =
        format!("{noisy}\n## 最终产物\n- [报告](<final report.md>)\n## 交接\n`draft.md`");
    let list = artifacts::collect(&state, &run, &[0, 1, 2]);
    assert_eq!(list.files.len(), 3);
    assert_eq!(list.files[0].relative_path, "final report.md");
    let evidence = artifacts::evidence(&state, &run, &[0, 1, 2]);
    assert_eq!(evidence["files"][0]["content"], "BODY-final report.md");
    assert_eq!(evidence["truncated"], true);
    // Missing files remain explicit errors; they must not become empty proof.
    std::fs::remove_file(state.dir.join("final report.md")).unwrap();
    assert_eq!(artifacts::collect(&state, &run, &[0, 1, 2]).files.len(), 2);
    let missing = artifacts::evidence(&state, &run, &[0, 1, 2]);
    assert!(missing["files"][0]["error"].is_string());
    assert!(missing["files"][0]["content"].is_null());
    run.steps[2].status = "pending".into();
    assert_eq!(artifacts::collect(&state, &run, &[0, 1, 2]).files.len(), 2);
    std::fs::write(state.dir.join("final report.md"), "updated").unwrap();
    run.steps[2].status = "running".into();
    assert_eq!(artifacts::collect(&state, &run, &[0, 1, 2]).files.len(), 3);
}

#[test]
fn manual_rework_handles_join_reviews_and_preserves_other_paths() {
    let (app, _tmp) = fixture(success());
    let server = decision_server(
        &app,
        vec![
            r#"{"passed":false,"summary":"请补充最终汇总和依据对应关系"}"#,
            r#"{"passed":true,"summary":"汇总已修订"}"#,
        ],
    );
    let steps = vec![
        step("agent"),
        step("agent"),
        step("agent"),
        step("review"),
        step("approval"),
        step("agent"),
        step("agent"),
    ];
    let source = steps[1].id.clone();
    let review = steps[3].id.clone();
    let unrelated = steps[6].id.clone();
    let id = launch(
        &app,
        graph_definition(
            steps,
            &[
                (0, 1, None),
                (0, 2, None),
                (1, 3, None),
                (2, 3, None),
                (3, 4, None),
                (4, 5, None),
            ],
        ),
    );
    let failed = settled(&app, &id);
    assert_eq!(failed.steps[3].status, "failed");
    assert!(rework::control(app.handle(), &id, failed.revision, &review, &unrelated, "").is_err());
    rework::control(
        app.handle(),
        &id,
        failed.revision,
        &review,
        &source,
        "保留分析，仅修订汇总",
    )
    .unwrap();
    assert!(rework::control(app.handle(), &id, failed.revision, &review, &source, "").is_err());
    let waiting = settled(&app, &id);
    assert_eq!(
        waiting.steps[4].status, "approval",
        "run error: {}; steps: {:?}",
        waiting.error, waiting.steps
    );
    server.join().unwrap();
    for i in [0, 2, 6] {
        assert_eq!(waiting.steps[i].attempts, 1);
    }
    assert_eq!(waiting.steps[1].attempts, 2);
    assert_eq!(waiting.steps[3].attempts, 2);
    assert_eq!(waiting.steps[4].status, "approval");
    assert_eq!(waiting.steps[5].attempts, 0);
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    let child = db
        .tasks
        .iter()
        .find(|t| Some(&t.id) == waiting.steps[1].task_ids.last())
        .unwrap();
    assert!(child.prompt.contains("请补充最终汇总和依据对应关系"));
    assert!(child.prompt.contains("保留分析，仅修订汇总"));
    assert_eq!(waiting.steps[1].task_ids.len(), 2);
}

#[test]
fn manual_rework_invalidates_descendants_and_reopens_approvals() {
    for graph_mode in [false, true] {
        let (app, _tmp) = fixture(success());
        let server = decision_server(&app, vec![r#"{"passed":false,"summary":"修改前序产物"}"#]);
        let steps = vec![
            step("agent"),
            step("approval"),
            step("agent"),
            step("review"),
        ];
        let source = steps[0].id.clone();
        let review = steps[3].id.clone();
        let id = launch(
            &app,
            if graph_mode {
                graph_definition(steps, &[(0, 1, None), (1, 2, None), (2, 3, None)])
            } else {
                definition(steps)
            },
        );
        let approval = settled(&app, &id);
        control(app.handle(), &id, "approve", approval.revision, "").unwrap();
        let failed = settled(&app, &id);
        server.join().unwrap();
        rework::control(app.handle(), &id, failed.revision, &review, &source, "").unwrap();
        let waiting = settled(&app, &id);
        assert_eq!(waiting.steps[0].attempts, 2);
        assert_eq!(waiting.steps[1].status, "approval");
        assert_eq!(waiting.steps[2].status, "pending");
        assert_eq!(waiting.steps[2].attempts, 1);
        assert_eq!(waiting.steps[3].status, "pending");
    }
}

#[test]
fn shared_input_preserves_fanin_conclusions_and_is_an_immutable_attempt_snapshot() {
    let (app, _tmp) = fixture(success());
    let id = launch(
        &app,
        graph_definition(
            vec![step("agent"), step("agent"), step("agent"), step("agent")],
            &[(0, 2, None), (1, 2, None)],
        ),
    );
    let mut run = settled(&app, &id);
    let state = app.state::<AppState>();
    for s in &mut run.steps {
        s.task_ids.clear();
    }
    for i in 0..2 {
        let name = format!("branch-{i}.md");
        std::fs::write(
            state.dir.join(&name),
            format!("BRANCH-{i}{}", "evidence ".repeat(7000)),
        )
        .unwrap();
        run.steps[i].output = format!(
            "Source {i} {}\n## 最终产物\n`{name}`\n## 交接\nCONCLUSION-{i}",
            "正文".repeat(7000)
        );
    }
    run.steps[3].output = "UNRELATED-OUTPUT".into();
    let indices = graph::ancestors(&run, 2);
    let context = sharing::context(&run, 2, &indices);
    let sources = context["sources"].as_array().unwrap();
    assert_eq!(sources.len(), 2);
    for (i, source) in sources.iter().enumerate() {
        assert_eq!(source["stepId"], run.definition.steps[i].id);
        assert_eq!(source["attempt"], run.steps[i].attempts);
        assert!(source["output"]
            .as_str()
            .unwrap()
            .ends_with(&format!("CONCLUSION-{i}")));
        assert_eq!(source["truncated"], true);
    }
    assert!(!context.to_string().contains("UNRELATED-OUTPUT"));
    let artifacts = artifacts::handoff(&state, &run, &indices);
    let files = artifacts["files"].as_array().unwrap();
    assert_eq!(files.len(), 2);
    assert!(files
        .iter()
        .all(|file| !file["content"].as_str().unwrap().is_empty()));
    assert!(
        files
            .iter()
            .map(|file| file["content"].as_str().unwrap().len())
            .sum::<usize>()
            <= 16 * 1024
    );
    assert_eq!(artifacts["truncated"], true);
    let input = serde_json::json!({"evidence":context,"artifacts":artifacts});
    sharing::capture(&state, &run, 2, &input).unwrap();
    let path = state
        .dir
        .join("workflow-inputs")
        .join(&run.id)
        .join(format!("2-{}.json", run.steps[2].attempts));
    std::fs::write(state.dir.join("branch-0.md"), "NEW FILE CONTENT").unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&std::fs::read(&path).unwrap()).unwrap(),
        input
    );
    run.steps[2].attempts += 1;
    let updated = serde_json::json!({"artifacts":artifacts::handoff(&state, &run, &indices)});
    sharing::capture(&state, &run, 2, &updated).unwrap();
    assert!(updated.to_string().contains("NEW FILE CONTENT"));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&std::fs::read(path).unwrap()).unwrap(),
        input
    );
    run.steps[0].status = "pending".into();
    assert_eq!(graph::ancestors(&run, 2), vec![1]);
}
