use super::*;
use serde_json::json;
use std::{
    io::Write,
    time::{Duration, Instant},
};
use tauri::test::{mock_builder, mock_context, noop_assets};
fn app() -> tauri::App<tauri::test::MockRuntime> {
    let a = mock_builder().build(mock_context(noop_assets())).unwrap();
    let dir = std::env::temp_dir().join(format!("oiagent-test-{}", uuid::Uuid::new_v4()));
    a.manage(AppState::load(dir).unwrap());
    a
}
fn agent(script: &str) -> Agent {
    Agent {
        id: "test".into(),
        name: "Test agent".into(),
        kind: "custom".into(),
        executable: "/bin/sh".into(),
        args: vec!["-c".into(), script.into(), "--".into(), "{prompt}".into()],
        available: true,
        version: String::new(),
        custom: true,
    }
}
fn input() -> TaskInput {
    TaskInput {
        provider_id: None,
        extra_args: vec![],
        env: Default::default(),
        title: "测试任务".into(),
        prompt: "Hello 'quoted' $(not-a-command)".into(),
        project: std::env::temp_dir().to_string_lossy().into(),
        agent_id: "test".into(),
        model: String::new(),
        permission: "read-only".into(),
        queued: true,
        resume_session: None,
    }
}
fn wait_task(a: &tauri::App<tauri::test::MockRuntime>, id: &str) -> Task {
    let start = Instant::now();
    loop {
        let s = a.state::<AppState>();
        let t =
            s.db.lock()
                .unwrap()
                .tasks
                .iter()
                .find(|t| t.id == id)
                .cloned()
                .unwrap();
        if !["queued", "running"].contains(&t.status.as_str()) {
            return t;
        }
        assert!(
            start.elapsed() < Duration::from_secs(12),
            "task timed out: {}",
            t.preview
        );
        std::thread::sleep(Duration::from_millis(40));
    }
}
#[test]
fn actual_process_stream_usage_and_persistence() {
    let a = app();
    let state = a.state::<AppState>();
    state.db.lock().unwrap().agents.push(agent("printf '%s\\n' '{\"type\":\"thread.started\",\"thread_id\":\"test-session\"}' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"完成验证\"}}' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":42,\"output_tokens\":8}}'"));
    let task = runtime::create(&state, input(), None).unwrap();
    assert_eq!(task.status, "queued");
    runtime::start(a.handle().clone(), task.id.clone()).unwrap();
    let task = wait_task(&a, &task.id);
    assert_eq!(task.status, "completed");
    assert_eq!(task.usage.input, 42);
    assert_eq!(task.usage.output, 8);
    assert_eq!(task.session_id.as_deref(), Some("test-session"));
    assert_eq!(task.exit_code, Some(0));
    let restored = AppState::load(state.dir.clone()).unwrap();
    assert_eq!(restored.db.lock().unwrap().tasks[0].status, "completed");
}
#[test]
fn additional_provider_streams_preserve_tools_usage_and_sessions() {
    let fixtures = [
        (
            vec![
                json!({"type":"init","session_id":"gemini-session"}),
                json!({"type":"message","role":"user","content":input().prompt}),
                json!({"type":"message","role":"assistant","content":"开始","delta":true}),
                json!({"type":"tool_use","tool_id":"read-1","tool_name":"read_file","parameters":{"file_path":"README.md"}}),
                json!({"type":"tool_result","tool_id":"read-1","status":"success","output":"文档内容"}),
                json!({"type":"result","status":"success","stats":{"input_tokens":100,"output_tokens":20,"cached":40}}),
            ],
            "gemini-session",
            100,
            20,
            40,
        ),
        (
            vec![
                json!({"type":"text","sessionID":"opencode-session","part":{"text":"完成检查"}}),
                json!({"type":"tool_use","sessionID":"opencode-session","part":{"callID":"read-1","tool":"read","state":{"input":{"filePath":"README.md"},"output":"文档内容","status":"completed"}}}),
                json!({"type":"step_finish","sessionID":"opencode-session","part":{"id":"step-1","tokens":{"input":60,"output":15,"reasoning":5,"cache":{"read":30,"write":10}}}}),
                // Duplicate step notifications must not double-count usage.
                json!({"type":"step_finish","sessionID":"opencode-session","part":{"id":"step-1","tokens":{"input":60,"output":15,"reasoning":5,"cache":{"read":30,"write":10}}}}),
            ],
            "opencode-session",
            100,
            20,
            30,
        ),
    ];
    for (events, session, input_tokens, output_tokens, cached) in fixtures {
        let a = app();
        let state = a.state::<AppState>();
        let event_path = state.dir.join("fixture.jsonl");
        std::fs::write(
            &event_path,
            events.iter().map(|v| format!("{v}\n")).collect::<String>(),
        )
        .unwrap();
        let mut executable = agent("");
        executable.executable = "/bin/cat".into();
        executable.args = vec![event_path.to_string_lossy().into(), "{prompt}".into()];
        state.db.lock().unwrap().agents.push(executable);
        // cat's second argument is an empty file, exercising literal argv safely.
        let empty = state.dir.join("empty");
        std::fs::write(&empty, "").unwrap();
        let mut request = input();
        request.prompt = empty.to_string_lossy().into();
        let task = runtime::create(&state, request, None).unwrap();
        runtime::start(a.handle().clone(), task.id.clone()).unwrap();
        let done = wait_task(&a, &task.id);
        assert_eq!(done.status, "completed");
        assert_eq!(done.session_id.as_deref(), Some(session));
        assert_eq!(
            (done.usage.input, done.usage.output, done.usage.cached),
            (input_tokens, output_tokens, cached)
        );
        let path = state
            .dir
            .join("logs")
            .join(format!("{}.messages.jsonl", task.id));
        let messages: Vec<Message> = std::fs::read_to_string(path)
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect();
        assert_eq!(messages.iter().filter(|m| m.role == "user").count(), 1);
        assert_eq!(messages.iter().filter(|m| m.role == "assistant").count(), 1);
        assert!(messages.iter().any(|m| m
            .tool
            .as_ref()
            .is_some_and(|t| t["callId"] == "read-1" && t["state"] == "completed")));
    }
}
#[test]
fn multi_block_assistant_text_is_not_repeated() {
    let a = app();
    let state = a.state::<AppState>();
    state.db.lock().unwrap().agents.push(agent("printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"第一段\"},{\"type\":\"text\",\"text\":\"第二段\"}]}}'"));
    let task = runtime::create(&state, input(), None).unwrap();
    runtime::start(a.handle().clone(), task.id.clone()).unwrap();
    assert_eq!(wait_task(&a, &task.id).status, "completed");
    let path = state
        .dir
        .join("logs")
        .join(format!("{}.messages.jsonl", task.id));
    let messages: Vec<Message> = std::fs::read_to_string(path)
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(messages.iter().filter(|m| m.role == "assistant").count(), 2);
}
#[test]
fn stop_terminates_process_group_and_preserves_cancelled() {
    let a = app();
    let state = a.state::<AppState>();
    state
        .db
        .lock()
        .unwrap()
        .agents
        .push(agent("sleep 30 & wait"));
    let task = runtime::create(&state, input(), None).unwrap();
    runtime::start(a.handle().clone(), task.id.clone()).unwrap();
    assert!(runtime::start(a.handle().clone(), task.id.clone()).is_err());
    let cancel_started = Instant::now();
    runtime::cancel(a.handle(), &task.id).unwrap();
    assert!(cancel_started.elapsed() < Duration::from_secs(2));
    let start = Instant::now();
    while state.children.lock().unwrap().contains_key(&task.id) {
        assert!(start.elapsed() < Duration::from_secs(5));
        std::thread::sleep(Duration::from_millis(30));
    }
    assert_eq!(state.db.lock().unwrap().tasks[0].status, "cancelled");
}
#[test]
fn failed_exit_is_not_completed() {
    let a = app();
    let state = a.state::<AppState>();
    state
        .db
        .lock()
        .unwrap()
        .agents
        .push(agent("printf 'connection refused' >&2; exit 7"));
    let task = runtime::create(&state, input(), None).unwrap();
    runtime::start(a.handle().clone(), task.id.clone()).unwrap();
    let t = wait_task(&a, &task.id);
    assert_eq!(t.status, "failed");
    assert_eq!(t.exit_code, Some(7));
    assert!(t.preview.contains("connection refused"));
}
#[test]
fn permission_denial_is_waiting_even_with_zero_exit() {
    let a = app();
    let state = a.state::<AppState>();
    state.db.lock().unwrap().agents.push(agent("printf '%s\\n' '{\"type\":\"result\",\"permission_denials\":[{\"tool_name\":\"Edit\"}],\"is_error\":false}'"));
    let task = runtime::create(&state, input(), None).unwrap();
    runtime::start(a.handle().clone(), task.id.clone()).unwrap();
    let t = wait_task(&a, &task.id);
    assert_eq!(t.status, "waiting");
}
#[test]
fn pty_round_trip_uses_real_terminal() {
    let a = app();
    let state = a.state::<AppState>();
    let task = terminal::launch(
        a.handle().clone(),
        &state,
        std::env::temp_dir().to_string_lossy().into(),
        "read answer; printf 'received:%s\\n' \"$answer\"".into(),
    )
    .unwrap();
    {
        let ptys = state.ptys.lock().unwrap();
        ptys[&task.id]
            .writer
            .lock()
            .unwrap()
            .write_all("终端测试\n".as_bytes())
            .unwrap();
    }
    let t = wait_task(&a, &task.id);
    assert_eq!(t.status, "completed");
    let output =
        std::fs::read_to_string(state.dir.join("logs").join(format!("{}.pty", t.id))).unwrap();
    assert!(output.contains("received:终端测试"));
}
#[test]
fn restart_marks_running_as_interrupted() {
    let a = app();
    let state = a.state::<AppState>();
    state.db.lock().unwrap().agents.push(agent("true"));
    let t = runtime::create(&state, input(), None).unwrap();
    state
        .update(&t.id, |t| t.status = "running".into())
        .unwrap();
    let restored = AppState::load(state.dir.clone()).unwrap();
    assert_eq!(restored.db.lock().unwrap().tasks[0].status, "interrupted");
}
#[test]
fn supervisor_plans_dispatches_and_reviews_with_local_mock_api() {
    use std::net::TcpListener;
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = std::thread::spawn(move || {
        for answer in [
            json!({"tasks":[{"title":"检查测试项目","prompt":"Check the fixture only","agent_id":"codex"}]}),
            json!({"passed":true,"summary":"已核对测试 Agent 的执行结果。"}),
        ] {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
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
            assert!(String::from_utf8_lossy(&request).contains("mock-model"));
            let body=json!({"choices":[{"message":{"content":answer.to_string()}}],"usage":{"prompt_tokens":20,"completion_tokens":10}}).to_string();
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        }
    });
    let a = app();
    let state = a.state::<AppState>();
    let script = state.dir.join("mock-agent");
    std::fs::write(&script,"#!/bin/sh\nprintf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"type\":\"agent_message\",\"text\":\"Fixture verified\"}}'\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    let mut mock = agent("");
    mock.id = "codex".into();
    mock.kind = "codex".into();
    mock.custom = false;
    mock.executable = script.to_string_lossy().into();
    state.db.lock().unwrap().agents.push(mock);
    *state.llm.lock().unwrap() = crate::llm_settings::LlmSettings::session(supervisor::LlmConfig {
        base_url: format!("http://{address}/v1"),
        model: "mock-model".into(),
        api_key: String::new(),
    });
    let parent = supervisor::launch(
        a.handle().clone(),
        &state,
        "Verify fixture".into(),
        state.dir.to_string_lossy().into(),
        "read-only".into(),
        2,
    )
    .unwrap();
    let done = wait_task(&a, &parent.id);
    assert_eq!(done.status, "completed");
    assert_eq!(done.usage.input, 40);
    let db = state.db.lock().unwrap();
    assert_eq!(db.tasks.len(), 2);
    assert_eq!(db.tasks[1].parent_id.as_deref(), Some(parent.id.as_str()));
    server.join().unwrap();
}
#[test]
#[ignore = "read-only diagnostics against installed local CLIs and session files"]
fn local_discovery_smoke() {
    let mut cache = history::HistoryCache::new();
    let (tasks, warnings) = cache.scan();
    let agents = discovery::discover(&[]);
    println!(
        "agents={} available={} sessions={} with_usage={} warnings={}",
        agents.len(),
        agents.iter().filter(|a| a.available).count(),
        tasks.len(),
        tasks.iter().filter(|t| t.usage.known).count(),
        warnings.len()
    );
    assert!(agents
        .iter()
        .all(|a| !a.available || std::path::Path::new(&a.executable).exists()));
    assert!(tasks
        .iter()
        .all(|t| !t.project.is_empty() && t.status == "imported"));
}

fn queued(text: &str, agent_id: &str) -> QueuedMessage {
    QueuedMessage {
        id: uuid::Uuid::new_v4().to_string(),
        text: text.into(),
        created_at: now(),
        agent_id: agent_id.into(),
        permission: "read-only".into(),
        model: String::new(),
        provider_id: None,
    }
}

#[test]
fn followups_keep_task_identity_order_and_cumulative_usage() {
    let a = app();
    let state = a.state::<AppState>();
    state.db.lock().unwrap().agents.push(agent("printf '%s\\n' '{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":2}}'"));
    let task = runtime::create(&state, input(), None).unwrap();
    state
        .update(&task.id, |t| {
            t.queued_messages = vec![queued("second turn", "test"), queued("third turn", "test")]
        })
        .unwrap();
    runtime::start(a.handle().clone(), task.id.clone()).unwrap();
    let start = Instant::now();
    loop {
        let done = wait_task(&a, &task.id);
        if done.queued_messages.is_empty() && done.status == "completed" {
            assert_eq!(done.usage.input, 30);
            assert_eq!(done.usage.output, 6);
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(12));
        std::thread::sleep(Duration::from_millis(20));
    }
    assert_eq!(state.db.lock().unwrap().tasks.len(), 1);
    let raw = std::fs::read_to_string(
        state
            .dir
            .join("logs")
            .join(format!("{}.messages.jsonl", task.id)),
    )
    .unwrap();
    let prompts: Vec<_> = raw
        .lines()
        .filter_map(|s| serde_json::from_str::<Message>(s).ok())
        .filter(|m| m.role == "user")
        .map(|m| m.text)
        .collect();
    assert_eq!(
        prompts,
        vec![input().prompt, "second turn".into(), "third turn".into()]
    );
}

#[test]
fn failed_turn_pauses_queued_messages() {
    let a = app();
    let state = a.state::<AppState>();
    state.db.lock().unwrap().agents.push(agent("exit 1"));
    let task = runtime::create(&state, input(), None).unwrap();
    state
        .update(&task.id, |t| {
            t.queued_messages
                .push(queued("must remain pending", "test"))
        })
        .unwrap();
    runtime::start(a.handle().clone(), task.id.clone()).unwrap();
    let done = wait_task(&a, &task.id);
    assert_eq!(done.status, "failed");
    followup::dispatch(a.handle().clone(), &task.id, false).unwrap();
    assert_eq!(state.db.lock().unwrap().tasks[0].queued_messages.len(), 1);
}

#[test]
fn switching_agent_carries_context_but_not_launch_secrets_or_other_session() {
    let a = app();
    let state = a.state::<AppState>();
    let mut target = agent("printf '%s\\n' \"${OIAGENT_TEST_SECRET-unset}\" \"$1\"");
    target.id = "target".into();
    target.kind = "other".into();
    state
        .db
        .lock()
        .unwrap()
        .agents
        .extend([agent("exit 0"), target]);
    let mut request = input();
    request
        .env
        .insert("OIAGENT_TEST_SECRET".into(), "fixture-secret".into());
    let task = runtime::create(&state, request, None).unwrap();
    runtime::append_record(
        &state,
        &task.id,
        &Message {
            role: "assistant".into(),
            text: "existing work summary".into(),
            timestamp: now(),
            agent_kind: Some("custom".into()),
            tool: None,
            parent_call_id: None,
            delta: false,
        },
    );
    state
        .update(&task.id, |t| {
            t.status = "completed".into();
            t.session_id = Some("original-session".into());
            t.extra_args = vec!["--original-agent-only".into()];
            t.sessions.push(AgentSession {
                agent_id: "target".into(),
                agent_kind: "other".into(),
                provider_id: None,
                session_id: "target-session".into(),
            });
            t.queued_messages
                .push(queued("continue checking", "target"));
        })
        .unwrap();
    followup::dispatch(a.handle().clone(), &task.id, false).unwrap();
    let done = wait_task(&a, &task.id);
    assert_eq!(done.status, "completed");
    assert_eq!(done.session_id.as_deref(), Some("target-session"));
    assert!(done
        .sessions
        .iter()
        .any(|s| s.agent_id == "test" && s.session_id == "original-session"));
    assert!(done.extra_args.is_empty() && done.env_keys.is_empty());
    let log = std::fs::read_to_string(state.log_path(&task.id)).unwrap();
    assert!(log.starts_with("unset\n"));
    assert!(log.contains("existing work summary") && log.contains("continue checking"));
    assert!(!log.contains("fixture-secret"));
    let disk = std::fs::read_to_string(state.dir.join("state.json")).unwrap();
    assert!(!disk.contains("fixture-secret"));
}

#[test]
fn tui_launch_resumes_the_original_agent_without_headless_flags() {
    for (kind, resume) in [("codex", "resume"), ("claude", "--resume")] {
        let a = app();
        let state = a.state::<AppState>();
        let mut executable = agent("unused");
        executable.kind = kind.into();
        state.db.lock().unwrap().agents.push(executable.clone());
        let mut request = input();
        request.resume_session = Some("same-native-session".into());
        request.model = "默认模型".into();
        let task = runtime::create(&state, request, None).unwrap();
        let args = launch::tui_arguments(&executable, &task).unwrap();
        assert!(args
            .windows(2)
            .any(|pair| pair == [resume, "same-native-session"]));
        assert!(!args
            .iter()
            .any(|a| ["exec", "--json", "--output-format", "-p", "--model"].contains(&a.as_str())));
    }
}
