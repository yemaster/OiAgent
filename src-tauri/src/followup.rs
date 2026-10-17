use crate::{models::*, runtime, store::AppState};
use tauri::{Manager, State};

pub(crate) fn task_gate(state: &AppState, id: &str) -> std::sync::Arc<std::sync::Mutex<()>> {
    let mut gates = state.followup_locks.lock().unwrap();
    gates.retain(|_, gate| gate.strong_count() > 0);
    if let Some(gate) = gates.get(id).and_then(std::sync::Weak::upgrade) {
        return gate;
    }
    let gate = std::sync::Arc::new(std::sync::Mutex::new(()));
    gates.insert(id.into(), std::sync::Arc::downgrade(&gate));
    gate
}

#[tauri::command]
pub async fn queue_message(
    app: tauri::AppHandle,
    id: String,
    text: String,
    agent_id: String,
    permission: String,
    model: String,
    provider_id: Option<String>,
    immediate: Option<bool>,
    model_options: Option<crate::model_options::ModelOptions>,
) -> Result<Task, String> {
    tauri::async_runtime::spawn_blocking(move || {
        queue_inner(
            app,
            id,
            text,
            agent_id,
            permission,
            model,
            provider_id,
            immediate.unwrap_or(false),
            model_options,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(crate) fn queue_inner<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    text: String,
    agent_id: String,
    permission: String,
    model: String,
    provider_id: Option<String>,
    immediate: bool,
    model_options: Option<crate::model_options::ModelOptions>,
) -> Result<Task, String> {
    let state = app.state::<AppState>();
    let gate = task_gate(&state, &id);
    let _gate = gate.lock().map_err(|e| e.to_string())?;
    if text.trim().is_empty() {
        return Err("请输入追加消息".into());
    }
    let missing = !state.db.lock().unwrap().tasks.iter().any(|t| t.id == id);
    if missing {
        let (history, _) = state.history.lock().unwrap().scan();
        let original = history
            .into_iter()
            .find(|t| t.id == id)
            .ok_or("会话不存在")?;
        if original.subagent_id.is_some() {
            return Err("请返回父会话追加消息".into());
        }
        let (mut task, messages) = crate::history::parse_file(
            std::path::Path::new(original.history_path.as_deref().ok_or("缺少历史文件")?),
            &original.agent_kind,
            true,
        )?;
        task.source = "managed".into();
        task.status = "completed".into();
        let mut db = state.db.lock().unwrap();
        let inserted = !db.tasks.iter().any(|t| t.id == id);
        if inserted {
            db.tasks.push(task);
            state.save(&db)?;
        }
        drop(db);
        if inserted {
            for message in messages {
                runtime::append_record(&state, &id, &message);
            }
        }
    }
    let project_guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    finish_terminal_input(&app, &id)?;
    let process_running = state.children.lock().unwrap().contains_key(&id);
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    if let Some(task) = db.tasks.iter().find(|t| t.id == id) {
        crate::temporary_projects::check_available(&db, &task.project)?;
    }
    let agent = db
        .agents
        .iter()
        .find(|a| a.id == agent_id && a.available)
        .ok_or("所选 Agent 不可用")?
        .clone();
    let permission = crate::launch::permission(&agent.kind, &permission)?;
    if let Some(options) = &model_options {
        options.validate(&agent.kind)?;
    }
    if let Some(provider) = &provider_id {
        if agent.kind != "claude" || !db.providers.iter().any(|p| &p.id == provider) {
            return Err("请选择有效的 Claude API 配置".into());
        }
    }
    let task = db
        .tasks
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or("任务不存在")?;
    if task.source != "managed" {
        return Err("此任务请在终端中直接输入".into());
    }
    task.terminal_id = None;
    if task.queued_messages.len() >= 30 {
        return Err("待发送消息最多 30 条".into());
    }
    let title_prompt = text.clone();
    let message = QueuedMessage {
        model_options,
        id: uuid::Uuid::new_v4().to_string(),
        text,
        created_at: now(),
        agent_id,
        permission,
        model,
        provider_id,
    };
    // A dead approval/process is not an active turn. A fresh user message resumes
    // a stopped conversation, ahead of any messages explicitly paused by Stop.
    reconcile_idle_status(task, process_running);
    let force = !["running", "queued", "waiting"].contains(&task.status.as_str());
    if immediate || force {
        task.queued_messages.insert(0, message);
    } else {
        task.queued_messages.push(message);
    }
    task.updated_at = now();
    task.archived = false;
    let result = task.clone();
    crate::temporary_projects::restore_group(&mut db, &id);
    crate::temporary_projects::update_expiry(&mut db, chrono::Utc::now());
    state.save(&db)?;
    drop(db);
    drop(project_guard);
    runtime::emit(&app, &result);
    let mut title_task = result.clone();
    title_task.active_prompt = Some(title_prompt);
    crate::task_titles::schedule(&app, &title_task);
    if immediate {
        let active = state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.id == id)
            .is_some_and(|t| matches!(t.status.as_str(), "running" | "waiting" | "queued"));
        if active {
            // Persist the new message first, then interrupt the current process.
            if let Err(error) = runtime::cancel_locked(&app, &id) {
                if state.children.lock().unwrap().contains_key(&id) {
                    return Err(error);
                }
            }
        }
    }
    // Stop returns before the output reader has drained. Do not leave a new
    // message stranded behind the cancelled run's still-registered process.
    if immediate || force {
        wait_for_cleanup(&state, &id)?;
    }
    dispatch_inner(app.clone(), &id, immediate || force)?;
    let latest = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .find(|t| t.id == id)
        .cloned()
        .ok_or("任务不存在")?;
    Ok(latest)
}
/// Caller holds the conversation gate, so a new TUI cannot take ownership here.
fn finish_terminal_input<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let terminal_id = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .find(|t| t.id == id)
        .and_then(|t| t.terminal_id.clone());
    if let Some(terminal_id) = &terminal_id {
        // The PTY registry owns the input lease until process cleanup completes.
        // Persisted status and transcript cursors are not process liveness signals.
        // Do not hold the database lock while acquiring the PTY registry lock.
        if state.ptys.lock().unwrap().contains_key(terminal_id) {
            return Err("终端仍在运行，请在终端中输入或先停止终端".into());
        }
        if let Some(updated) = crate::terminal_history::finish_owner(&state, id, terminal_id)? {
            runtime::emit(app, &updated);
        }
    }
    Ok(())
}

fn reconcile_idle_status(task: &mut Task, process_running: bool) {
    if !process_running && matches!(task.status.as_str(), "running" | "waiting" | "stopping") {
        task.status = if task.status == "stopping" {
            "cancelled"
        } else {
            "interrupted"
        }
        .into();
    }
}

fn wait_for_cleanup(state: &AppState, id: &str) -> Result<(), String> {
    let started = std::time::Instant::now();
    while state.children.lock().unwrap().contains_key(id) {
        if started.elapsed() > std::time::Duration::from_secs(10) {
            return Err("当前执行尚未停止，消息已保留在队列中".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    Ok(())
}
#[tauri::command]
pub fn remove_queued_message<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: State<AppState>,
    id: String,
    message_id: String,
) -> Result<Task, String> {
    let gate = task_gate(&state, &id);
    let _gate = gate.lock().map_err(|e| e.to_string())?;
    // Queue delivery takes the same gate. Never report a successful withdrawal
    // after the message has already been handed to the agent.
    if !state
        .db
        .lock()
        .map_err(|e| e.to_string())?
        .tasks
        .iter()
        .find(|task| task.id == id)
        .is_some_and(|task| {
            task.queued_messages
                .iter()
                .any(|message| message.id == message_id)
        })
    {
        return Err("消息已发送或已移出队列".into());
    }
    let task = state.update(&id, |t| t.queued_messages.retain(|m| m.id != message_id))?;
    runtime::emit(&app, &task);
    Ok(task)
}
#[tauri::command]
pub async fn run_queued_messages(
    app: tauri::AppHandle,
    id: String,
    immediate: Option<bool>,
    message_id: Option<String>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_pending(app, &id, immediate.unwrap_or(false), message_id.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}
pub(crate) fn run_pending<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: &str,
    immediate: bool,
    message_id: Option<&str>,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let gate = task_gate(&state, id);
    let _gate = gate.lock().map_err(|e| e.to_string())?;
    finish_terminal_input(&app, id)?;
    let process_running = state.children.lock().unwrap().contains_key(id);
    let task =
        {
            let mut db = state.db.lock().unwrap();
            let previous = db.tasks.iter().find(|t| t.id == id).ok_or("任务不存在")?;
            let selected = match message_id {
                Some(message_id) => previous
                    .queued_messages
                    .iter()
                    .find(|m| m.id == message_id)
                    .ok_or("消息已发送或移除")?,
                None => match previous.queued_messages.first() {
                    Some(message) => message,
                    None => return Ok(()),
                },
            };
            // Reject an unusable queued configuration before interrupting any work.
            let agent = db
                .agents
                .iter()
                .find(|a| a.id == selected.agent_id && a.available)
                .ok_or("队列中的 Agent 不可用")?;
            crate::launch::permission(&agent.kind, &selected.permission)?;
            if let Some(options) = &selected.model_options {
                options.validate(&agent.kind)?;
            }
            if selected.provider_id.as_ref().is_some_and(|id| {
                agent.kind != "claude" || !db.providers.iter().any(|p| &p.id == id)
            }) {
                return Err("请选择有效的 Claude API 配置".into());
            }
            let task = db
                .tasks
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or("任务不存在")?;
            if task.source != "managed" {
                return Err("此任务请在终端中直接输入".into());
            }
            task.terminal_id = None;
            reconcile_idle_status(task, process_running);
            if let Some(message_id) = message_id {
                let index = task
                    .queued_messages
                    .iter()
                    .position(|m| m.id == message_id)
                    .ok_or("消息已发送或移除")?;
                if immediate {
                    let message = task.queued_messages.remove(index);
                    task.queued_messages.insert(0, message);
                }
            }
            if task.queued_messages.is_empty() {
                return Ok(());
            }
            let task = task.clone();
            state.save(&db)?;
            task
        };
    if immediate && matches!(task.status.as_str(), "running" | "waiting" | "queued") {
        runtime::cancel_locked(&app, id)?;
    } else if matches!(task.status.as_str(), "running" | "waiting" | "queued")
        && state.children.lock().unwrap().contains_key(id)
    {
        return Err("当前执行尚未结束，可选择立即发送".into());
    }
    wait_for_cleanup(&state, id)?;
    dispatch_inner(app.clone(), id, true)
}

pub fn dispatch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: &str,
    force: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let gate = task_gate(&state, &id);
    let _gate = gate.lock().map_err(|e| e.to_string())?;
    dispatch_inner(app.clone(), id, force)
}
fn dispatch_inner<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: &str,
    force: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let registry = state.children.lock().map_err(|e| e.to_string())?;
    if registry.contains_key(id) {
        return Ok(());
    }
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let previous = db
        .tasks
        .iter()
        .find(|t| t.id == id)
        .ok_or("任务不存在")?
        .clone();
    if previous.queued_messages.is_empty()
        || previous.source != "managed"
        || previous.terminal_id.is_some()
    {
        return Ok(());
    }
    if previous.status != "completed"
        && !(force
            && ["failed", "cancelled", "interrupted", "waiting"]
                .contains(&previous.status.as_str()))
    {
        return Ok(());
    }
    let message = previous.queued_messages[0].clone();
    let agent = db
        .agents
        .iter()
        .find(|a| a.id == message.agent_id && a.available)
        .cloned()
        .ok_or("队列中的 Agent 不可用")?;
    let task = db.tasks.iter_mut().find(|t| t.id == id).unwrap();
    if task.usage_by_agent.is_empty() {
        task.usage_by_agent
            .insert(task.agent_kind.clone(), task.usage.clone());
    }
    if let Some(sid) = &task.session_id {
        if !task
            .sessions
            .iter()
            .any(|s| s.agent_id == task.agent_id && s.provider_id == task.provider_id)
        {
            task.sessions.push(AgentSession {
                agent_id: task.agent_id.clone(),
                agent_kind: task.agent_kind.clone(),
                provider_id: task.provider_id.clone(),
                session_id: sid.clone(),
            });
        }
    }
    task.context_handoff = task.agent_id != agent.id || task.provider_id != message.provider_id;
    if task.agent_id != agent.id {
        task.extra_args.clear();
        task.env_keys.clear();
        state.launch_envs.lock().unwrap().remove(id);
    }
    crate::launch::environment(&state, task)?;
    task.agent_id = agent.id;
    task.agent_kind = agent.kind;
    task.provider_id = message.provider_id.clone();
    task.session_id = task
        .sessions
        .iter()
        .find(|s| s.agent_id == task.agent_id && s.provider_id == task.provider_id)
        .map(|s| s.session_id.clone());
    task.permission = message.permission.clone();
    task.model = message.model.clone();
    if let Some(options) = &message.model_options {
        task.extra_args = options.apply(&task.agent_kind, &task.extra_args);
    }
    task.session_usage = None;
    task.queued_messages.remove(0);
    task.active_prompt = Some(message.text.clone());
    task.status = "queued".into();
    task.exit_code = None;
    let next = task.clone();
    state.save(&db)?;
    drop(db);
    drop(registry);
    runtime::emit(&app, &next);
    if let Err(error) = runtime::start(app.clone(), id.to_string()) {
        if let Ok(task) = state.update(id, |t| {
            t.queued_messages.insert(0, message);
            t.status = "failed".into();
            t.preview = error.clone();
        }) {
            runtime::emit(&app, &task);
        }
        return Err(error);
    }
    Ok(())
}
/// Bounded, explicit handoff context. Never reuse a different provider's native session ID.
pub fn context(state: &AppState, task: &Task, prompt: &str) -> String {
    let raw = std::fs::read_to_string(
        state
            .dir
            .join("logs")
            .join(format!("{}.messages.jsonl", task.id)),
    )
    .unwrap_or_default();
    let mut rows: Vec<String> = raw
        .lines()
        .filter_map(|line| serde_json::from_str::<Message>(line).ok())
        .filter(|m| ["user", "assistant", "tool"].contains(&m.role.as_str()))
        .map(|m| {
            let text = if let Some(tool) = m.tool {
                tool.to_string()
            } else {
                m.text
            };
            format!(
                "[{} / {}] {}",
                m.agent_kind.unwrap_or_else(|| task.agent_kind.clone()),
                m.role,
                crate::history::short(&text, 4000)
            )
        })
        .rev()
        .take(40)
        .collect();
    rows.reverse();
    let recent = rows.join("\n\n");
    let tail: String = recent
        .chars()
        .rev()
        .take(48000)
        .collect::<String>()
        .chars()
        .rev()
        .collect();
    crate::llm_prompts::handoff(serde_json::json!({
        "project": task.project, "originalTask": crate::history::short(&task.prompt, 8000),
        "previousContext": tail, "newInstruction": prompt
    }))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use serde_json::json;
    use std::{
        io::Write,
        time::{Duration, Instant},
    };
    use tauri::test::{mock_builder, mock_context, noop_assets, MockRuntime};

    fn fixture() -> (tauri::App<MockRuntime>, tempfile::TempDir) {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().canonicalize().unwrap();
        let executable = dir.join("agent");
        std::fs::write(
            &executable,
            r#"#!/bin/sh
n=0
[ ! -f count ] || n=$(cat count)
n=$((n+1))
printf '%s' "$n" > count
printf '%s' "$1" > "prompt-$n"
printf 'started' > "ready-$n"
i=0
while [ "$n" -lt 3 ] && [ ! -f "release-$n" ] && [ "$i" -lt 200 ]; do
  sleep 0.05
  i=$((i+1))
done
printf 'done\n'
"#,
        )
        .unwrap();
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let state = AppState::load(dir.clone()).unwrap();
        {
            let mut db = state.db.lock().unwrap();
            db.agents.push(Agent {
                id: "fixture".into(),
                name: "Fixture".into(),
                kind: "custom".into(),
                executable: executable.to_string_lossy().into(),
                args: vec!["{prompt}".into()],
                available: true,
                version: String::new(),
                custom: true,
            });
            db.tasks.push(serde_json::from_value(json!({"id":"task","title":"test","prompt":"original goal","project":dir,"agentId":"fixture","agentKind":"custom","status":"queued","preview":"","createdAt":"","updatedAt":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"read-only","exitCode":null,"sessionId":null})).unwrap());
        }
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        app.manage(state);
        (app, tmp)
    }
    fn wait_until(predicate: impl Fn() -> bool) {
        let start = Instant::now();
        while !predicate() {
            assert!(
                start.elapsed() < Duration::from_secs(6),
                "fixture timed out"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }
    fn send(app: &tauri::App<MockRuntime>, text: &str, immediate: bool) -> Result<Task, String> {
        queue_inner(
            app.handle().clone(),
            "task".into(),
            text.into(),
            "fixture".into(),
            "read-only".into(),
            "".into(),
            None,
            immediate,
            None,
        )
    }
    #[test]
    fn exited_terminals_never_hold_the_input_lease_through_saved_status_or_cursor() {
        for (kind, status) in [
            ("codex", "running"),
            ("claude", "stopping"),
            ("qwen", "cancelled"),
            ("qodercn", "completed"),
            ("custom", "interrupted"),
            ("codex", "failed"),
        ] {
            let (app, dir) = fixture();
            let state = app.state::<AppState>();
            let native = dir.path().join("native.jsonl");
            std::fs::write(&native, "").unwrap();
            {
                let mut db = state.db.lock().unwrap();
                let owner = &mut db.tasks[0];
                owner.status = status.into();
                owner.terminal_id = Some("old-pty".into());
                let mut terminal = owner.clone();
                terminal.id = "old-pty".into();
                terminal.source = "terminal".into();
                terminal.parent_id = Some("task".into());
                terminal.terminal_id = None;
                terminal.agent_kind = kind.into();
                terminal.session_id = Some("session".into());
                terminal.terminal_cursor = Some(TerminalCursor {
                    finished: false,
                    path: Some(native.to_string_lossy().into()),
                    offset: 0,
                    after: None,
                });
                db.tasks.push(terminal);
            }
            std::fs::write(dir.path().join("release-1"), "").unwrap();
            let resumed = send(&app, "continue after terminal exit", false).unwrap();
            assert!(resumed.terminal_id.is_none(), "{kind}/{status}");
            wait_until(|| dir.path().join("ready-1").exists());
            wait_until(|| state.children.lock().unwrap().is_empty());
            let db = state.db.lock().unwrap();
            assert_eq!(db.tasks[0].status, "completed", "{kind}/{status}");
            assert!(db.tasks[0].queued_messages.is_empty());
            if kind != "custom" {
                assert!(db.tasks[1].terminal_cursor.as_ref().unwrap().finished);
            }
        }
    }

    #[test]
    fn queued_messages_resume_after_terminal_exit_including_restored_stopping_state() {
        let (app, dir) = fixture();
        let state = app.state::<AppState>();
        send(&app, "already queued", false).unwrap();
        state
            .update("task", |t| {
                t.status = "stopping".into();
                t.terminal_id = Some("missing-pty".into());
            })
            .unwrap();
        // Restart restores task data but never recreates old PTY handles.
        let restored = AppState::load(state.dir.clone()).unwrap();
        assert_eq!(restored.db.lock().unwrap().tasks[0].status, "interrupted");
        std::fs::write(dir.path().join("release-1"), "").unwrap();
        run_pending(app.handle().clone(), "task", true, None).unwrap();
        wait_until(|| dir.path().join("ready-1").exists());
        wait_until(|| state.children.lock().unwrap().is_empty());
        let db = state.db.lock().unwrap();
        assert_eq!(db.tasks[0].status, "completed");
        assert!(db.tasks[0].terminal_id.is_none());
        assert!(db.tasks[0].queued_messages.is_empty());
    }

    #[test]
    fn live_terminal_blocks_followups_until_normal_exit_or_stop_finishes() {
        for stop in [false, true] {
            let (app, dir) = fixture();
            let state = app.state::<AppState>();
            let terminal = crate::terminal::launch(
                app.handle().clone(),
                &state,
                dir.path().to_string_lossy().into(),
                "read answer".into(),
            )
            .unwrap();
            state
                .update(&terminal.id, |t| t.parent_id = Some("task".into()))
                .unwrap();
            state
                .update("task", |t| {
                    // Even a stale final owner status must not allow two input writers.
                    t.status = "cancelled".into();
                    t.terminal_id = Some(terminal.id.clone());
                })
                .unwrap();
            assert!(send(&app, "must wait", false)
                .unwrap_err()
                .contains("终端仍在运行"));
            assert!(send(&app, "must also wait", true)
                .unwrap_err()
                .contains("终端仍在运行"));
            assert!(!dir.path().join("ready-1").exists());
            if stop {
                crate::stop_task_inner(app.handle().clone(), state.clone(), terminal.id.clone())
                    .unwrap();
            } else {
                state.ptys.lock().unwrap()[&terminal.id]
                    .writer
                    .lock()
                    .unwrap()
                    .write_all(b"done\n")
                    .unwrap();
            }
            wait_until(|| {
                let db = state.db.lock().unwrap();
                db.tasks
                    .iter()
                    .find(|t| t.id == terminal.id)
                    .is_some_and(|t| t.status == if stop { "cancelled" } else { "completed" })
            });
            assert!(!state.ptys.lock().unwrap().contains_key(&terminal.id));
            std::fs::write(dir.path().join("release-1"), "").unwrap();
            assert!(send(&app, "resume now", false)
                .unwrap()
                .terminal_id
                .is_none());
            wait_until(|| dir.path().join("ready-1").exists());
            wait_until(|| state.children.lock().unwrap().is_empty());
            assert_eq!(state.db.lock().unwrap().tasks[0].status, "completed");
        }
    }

    #[test]
    fn immediate_delivery_stops_before_resuming_and_preserves_the_remaining_queue() {
        let (app, dir) = fixture();
        runtime::start(app.handle().clone(), "task".into()).unwrap();
        wait_until(|| dir.path().join("ready-1").exists());
        send(&app, "later", false).unwrap();
        assert!(!dir.path().join("ready-2").exists());
        let urgent = send(&app, "urgent", true).unwrap();
        assert_eq!(urgent.active_prompt.as_deref(), Some("urgent"));
        assert_eq!(urgent.queued_messages.len(), 1);
        assert_eq!(urgent.queued_messages[0].text, "later");
        wait_until(|| dir.path().join("ready-2").exists());
        let prompt = std::fs::read_to_string(dir.path().join("prompt-2")).unwrap();
        assert!(prompt.contains("original goal") && prompt.contains("urgent"));
        std::fs::write(dir.path().join("release-2"), "").unwrap();
        let state = app.state::<AppState>();
        wait_until(|| {
            let db = state.db.lock().unwrap();
            db.tasks[0].status == "completed" && db.tasks[0].queued_messages.is_empty()
        });
        wait_until(|| state.children.lock().unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(dir.path().join("count")).unwrap(),
            "3"
        );
        assert!(std::fs::read_to_string(dir.path().join("prompt-3"))
            .unwrap()
            .contains("later"));
    }
    #[test]
    fn invalid_immediate_message_does_not_cancel_and_stop_keeps_queue_paused() {
        let (app, dir) = fixture();
        runtime::start(app.handle().clone(), "task".into()).unwrap();
        wait_until(|| dir.path().join("ready-1").exists());
        assert!(send(&app, "   ", true).is_err());
        let state = app.state::<AppState>();
        assert_eq!(state.db.lock().unwrap().tasks[0].status, "running");
        send(&app, "later", false).unwrap();
        runtime::cancel(app.handle(), "task").unwrap();
        wait_until(|| state.children.lock().unwrap().is_empty());
        let task = state.db.lock().unwrap().tasks[0].clone();
        assert_eq!(task.status, "cancelled");
        assert_eq!(task.queued_messages[0].text, "later");
        assert!(!dir.path().join("ready-2").exists());
    }
    #[test]
    fn queued_model_options_are_saved_and_applied_only_when_that_message_runs() {
        let (app, dir) = fixture();
        let state = app.state::<AppState>();
        {
            let mut db = state.db.lock().unwrap();
            db.agents[0].kind = "codex".into();
            db.agents[0].custom = false;
            db.tasks[0].agent_kind = "codex".into();
            db.tasks[0].extra_args = vec!["-c".into(), "foo=1".into()];
        }
        runtime::start(app.handle().clone(), "task".into()).unwrap();
        wait_until(|| dir.path().join("ready-1").exists());
        let options = crate::model_options::ModelOptions {
            effort: "high".into(),
            service_tier: "priority".into(),
            ..Default::default()
        };
        let queued = queue_inner(
            app.handle().clone(),
            "task".into(),
            "next".into(),
            "fixture".into(),
            "read-only".into(),
            "chosen-model".into(),
            None,
            false,
            Some(options),
        )
        .unwrap();
        assert_eq!(queued.extra_args, ["-c", "foo=1"]);
        assert_eq!(
            queued.queued_messages[0]
                .model_options
                .as_ref()
                .unwrap()
                .effort,
            "high"
        );
        let saved: Database =
            serde_json::from_slice(&std::fs::read(state.dir.join("state.json")).unwrap()).unwrap();
        assert_eq!(
            saved.tasks[0].queued_messages[0]
                .model_options
                .as_ref()
                .unwrap()
                .service_tier,
            "priority"
        );
        runtime::cancel(app.handle(), "task").unwrap();
        wait_until(|| state.children.lock().unwrap().is_empty());
        std::fs::write(dir.path().join("release-2"), "").unwrap();
        dispatch(app.handle().clone(), "task", true).unwrap();
        wait_until(|| dir.path().join("ready-2").exists());
        wait_until(|| state.children.lock().unwrap().is_empty());
        let current = state.db.lock().unwrap().tasks[0].clone();
        assert_eq!(current.model, "chosen-model");
        assert_eq!(
            current.extra_args,
            [
                "-c",
                "foo=1",
                "-c",
                "model_reasoning_effort=\"high\"",
                "-c",
                "service_tier=\"priority\""
            ]
        );
        assert!(current.queued_messages.is_empty());
    }
    #[test]
    fn launch_failure_keeps_message_for_retry_and_gates_are_per_task() {
        let (app, dir) = fixture();
        let state = app.state::<AppState>();
        state
            .update("task", |t| t.status = "completed".into())
            .unwrap();
        std::fs::remove_file(dir.path().join("agent")).unwrap();
        assert!(send(&app, "keep me", true).is_err());
        let task = state.db.lock().unwrap().tasks[0].clone();
        assert_eq!(task.status, "failed");
        assert_eq!(task.queued_messages[0].text, "keep me");
        let first = task_gate(&state, "one");
        let same = task_gate(&state, "one");
        let other = task_gate(&state, "two");
        assert!(std::sync::Arc::ptr_eq(&first, &same));
        assert!(!std::sync::Arc::ptr_eq(&first, &other));
    }

    #[test]
    fn default_send_immediately_after_stop_resumes_and_preserves_paused_messages() {
        let (app, dir) = fixture();
        let state = app.state::<AppState>();
        runtime::start(app.handle().clone(), "task".into()).unwrap();
        wait_until(|| dir.path().join("ready-1").exists());
        send(&app, "older queued message", false).unwrap();
        runtime::cancel(app.handle(), "task").unwrap();
        // Deliberately do not wait for registry/output cleanup before sending.
        let next = send(&app, "new message after stop", false).unwrap();
        assert_eq!(next.status, "running");
        assert_eq!(
            next.active_prompt.as_deref(),
            Some("new message after stop")
        );
        assert_eq!(next.queued_messages.len(), 1);
        assert_eq!(next.queued_messages[0].text, "older queued message");
        wait_until(|| dir.path().join("ready-2").exists());
        runtime::cancel(app.handle(), "task").unwrap();
        wait_until(|| state.children.lock().unwrap().is_empty());
        assert_eq!(state.db.lock().unwrap().tasks[0].status, "cancelled");
        assert!(!crate::approvals::live(&state, "task"));
    }

    #[test]
    fn stopped_waiting_without_a_process_does_not_require_another_user_action() {
        for status in ["waiting", "running", "cancelled", "interrupted", "failed"] {
            let (app, dir) = fixture();
            let state = app.state::<AppState>();
            state.update("task", |t| t.status = status.into()).unwrap();
            let next = send(&app, "continue now", false).unwrap();
            assert_eq!(next.status, "running", "previous status: {status}");
            assert!(next.queued_messages.is_empty());
            wait_until(|| dir.path().join("ready-1").exists());
            runtime::cancel(app.handle(), "task").unwrap();
            wait_until(|| state.children.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn queued_message_can_interrupt_without_being_duplicated_or_losing_fifo_order() {
        let (app, dir) = fixture();
        let state = app.state::<AppState>();
        runtime::start(app.handle().clone(), "task".into()).unwrap();
        wait_until(|| dir.path().join("ready-1").exists());
        send(&app, "first", false).unwrap();
        let queued = send(&app, "second", false).unwrap();
        let id = queued.queued_messages[1].id.clone();
        assert!(run_pending(app.handle().clone(), "task", true, Some("missing")).is_err());
        assert_eq!(state.db.lock().unwrap().tasks[0].status, "running");
        run_pending(app.handle().clone(), "task", true, Some(&id)).unwrap();
        let next = state.db.lock().unwrap().tasks[0].clone();
        assert_eq!(next.active_prompt.as_deref(), Some("second"));
        assert_eq!(next.queued_messages.len(), 1);
        assert_eq!(next.queued_messages[0].text, "first");
        assert!(run_pending(app.handle().clone(), "task", true, Some(&id)).is_err());
        wait_until(|| dir.path().join("ready-2").exists());
        runtime::cancel(app.handle(), "task").unwrap();
        wait_until(|| state.children.lock().unwrap().is_empty());
    }

    #[test]
    fn stop_remains_stopping_until_output_cleanup_finishes() {
        let (app, dir) = fixture();
        std::fs::write(
            dir.path().join("agent"),
            r#"#!/bin/sh
(sleep 3) &
touch ready-1
exit 0
"#,
        )
        .unwrap();
        let state = app.state::<AppState>();
        runtime::start(app.handle().clone(), "task".into()).unwrap();
        wait_until(|| dir.path().join("ready-1").exists());
        // Let the root exit while its inherited output remains open.
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(
            runtime::cancel(app.handle(), "task").unwrap().status,
            "stopping"
        );
        assert_eq!(
            runtime::cancel(app.handle(), "task").unwrap().status,
            "stopping"
        );
        wait_until(|| state.children.lock().unwrap().is_empty());
        assert_eq!(state.db.lock().unwrap().tasks[0].status, "cancelled");
    }

    #[test]
    fn inherited_pipe_does_not_block_next_turn_or_apply_late_approval_to_it() {
        let (app, dir) = fixture();
        // The first shell exits while its background child keeps the pipe open.
        std::fs::write(dir.path().join("agent"), r#"#!/bin/sh
if [ ! -f first-run ]; then
  touch first-run
  (sleep 3; printf '%s\n' '{"type":"control_request","request_id":"old","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{}}}'; touch late-output) &
  exit 0
fi
printf 'new turn complete\n'
"#).unwrap();
        let state = app.state::<AppState>();
        runtime::start(app.handle().clone(), "task".into()).unwrap();
        wait_until(|| state.children.lock().unwrap().is_empty());
        assert!(!dir.path().join("late-output").exists());
        send(&app, "next turn", false).unwrap();
        wait_until(|| state.children.lock().unwrap().is_empty());
        wait_until(|| dir.path().join("late-output").exists());
        // Ensure the late pipe frame has actually been drained/ignored.
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(state.db.lock().unwrap().tasks[0].status, "completed");
        assert!(!crate::approvals::live(&state, "task"));
        assert!(!std::fs::read_to_string(state.log_path("task"))
            .unwrap()
            .contains("can_use_tool"));
    }
}
