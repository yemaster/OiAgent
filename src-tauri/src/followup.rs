use crate::{models::*, runtime, store::AppState};
use tauri::{Manager, State};

fn task_gate(state: &AppState, id: &str) -> std::sync::Arc<std::sync::Mutex<()>> {
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
    if let Some(updated) = crate::terminal_history::sync_owner(&state, &id)? {
        runtime::emit(&app, &updated);
    }
    let project_guard = state.project_lock.lock().map_err(|e| e.to_string())?;
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
    if let Some(provider) = &provider_id {
        if agent.kind != "claude" || !db.providers.iter().any(|p| &p.id == provider) {
            return Err("请选择有效的 Claude API 配置".into());
        }
    }
    let terminal_running = db
        .tasks
        .iter()
        .find(|t| t.id == id)
        .and_then(|t| t.terminal_id.as_ref())
        .is_some_and(|terminal_id| {
            db.tasks.iter().any(|t| {
                &t.id == terminal_id
                    && (t.status == "running"
                        || state.ptys.lock().unwrap().contains_key(&t.id)
                        || (t.session_id.is_some()
                            && ["codex", "claude", "qwen"].contains(&t.agent_kind.as_str())
                            && t.terminal_cursor.as_ref().is_some_and(|c| !c.finished)))
            })
        });
    if terminal_running {
        return Err("终端仍在运行，请在终端中输入或先停止终端".into());
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
    let message = QueuedMessage {
        id: uuid::Uuid::new_v4().to_string(),
        text,
        created_at: now(),
        agent_id,
        permission,
        model,
        provider_id,
    };
    if immediate {
        task.queued_messages.insert(0, message);
    } else {
        task.queued_messages.push(message);
    }
    task.updated_at = now();
    let force = !["running", "queued", "waiting"].contains(&task.status.as_str());
    task.archived = false;
    let result = task.clone();
    crate::temporary_projects::restore_group(&mut db, &id);
    crate::temporary_projects::update_expiry(&mut db, chrono::Utc::now());
    state.save(&db)?;
    drop(db);
    drop(project_guard);
    runtime::emit(&app, &result);
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
            if let Err(error) = runtime::cancel(&app, &id) {
                if state.children.lock().unwrap().contains_key(&id) {
                    return Err(error);
                }
            }
        }
        let started = std::time::Instant::now();
        while state.children.lock().unwrap().contains_key(&id) {
            if started.elapsed() > std::time::Duration::from_secs(10) {
                return Err("当前执行尚未停止，消息已保留在队列中".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
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
#[tauri::command]
pub fn remove_queued_message<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: State<AppState>,
    id: String,
    message_id: String,
) -> Result<Task, String> {
    let task = state.update(&id, |t| t.queued_messages.retain(|m| m.id != message_id))?;
    runtime::emit(&app, &task);
    Ok(task)
}
#[tauri::command]
pub fn run_queued_messages<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    dispatch(app, &id, true)
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
    use std::time::{Duration, Instant};
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
        )
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
}
