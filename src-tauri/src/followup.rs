use crate::{models::*, runtime, store::AppState};
use tauri::{Manager, State};

#[tauri::command]
pub fn queue_message(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
    text: String,
    agent_id: String,
    permission: String,
    model: String,
    provider_id: Option<String>,
) -> Result<Task, String> {
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
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
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
    task.queued_messages.push(QueuedMessage {
        id: uuid::Uuid::new_v4().to_string(),
        text,
        created_at: now(),
        agent_id,
        permission,
        model,
        provider_id,
    });
    task.updated_at = now();
    let force = !["running", "queued", "waiting"].contains(&task.status.as_str());
    let result = task.clone();
    state.save(&db)?;
    drop(db);
    runtime::emit(&app, &result);
    dispatch(app, &id, force)?;
    Ok(result)
}
#[tauri::command]
pub fn remove_queued_message(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
    message_id: String,
) -> Result<Task, String> {
    let task = state.update(&id, |t| t.queued_messages.retain(|m| m.id != message_id))?;
    runtime::emit(&app, &task);
    Ok(task)
}
#[tauri::command]
pub fn run_queued_messages(app: tauri::AppHandle, id: String) -> Result<(), String> {
    dispatch(app, &id, true)
}

pub fn dispatch<R: tauri::Runtime>(
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
    format!("继续处理同一项目中的任务。以下是已发生的对话和工具记录，用于交接上下文；请核实项目当前文件状态。\n项目：{}\n原任务：{}\n<previous_context>\n{}\n</previous_context>\n用户的新指令：\n{}", task.project, crate::history::short(&task.prompt, 8000), tail, prompt)
}
