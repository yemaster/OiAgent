//! Editing creates a fresh native session from an exact prefix. Source logs are immutable.
use crate::{file_rewind, models::*, store::AppState};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs, io::Write};
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditRecord {
    pub task_id: String,
    pub source_id: String,
    pub fingerprint: String,
    pub context: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditInput {
    pub id: String,
    pub revision: String,
    pub index: usize,
    pub text: String,
    pub mode: String,
    pub request_id: String,
    pub rewind_token: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prepared {
    pub rewind: Option<file_rewind::Preview>,
    pub rewind_unavailable: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Edited {
    pub task: Task,
    pub launch_error: Option<String>,
}
pub fn revision(task: &Task, messages: &[Message]) -> String {
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                task.id.as_str(),
                task.session_id.as_ref(),
                task.updated_at.as_str(),
                messages
            ))
            .unwrap_or_default()
        )
    )
}
fn idle(state: &AppState, task: &Task, workspace: bool) -> Result<(), String> {
    if state
        .shutting_down
        .load(std::sync::atomic::Ordering::Acquire)
    {
        return Err("应用正在退出".into());
    }
    let tasks = state.db.lock().unwrap().tasks.clone();
    let mut ids = vec![task.id.as_str()];
    ids.extend(
        tasks
            .iter()
            .filter(|t| {
                if workspace {
                    t.project == task.project
                } else {
                    t.parent_id.as_deref() == Some(task.id.as_str())
                        || task.terminal_id.as_deref() == Some(t.id.as_str())
                }
            })
            .map(|t| t.id.as_str()),
    );
    if ["running", "waiting", "queued", "stopping"].contains(&task.status.as_str())
        || tasks.iter().any(|t| {
            ids.contains(&t.id.as_str())
                && ["running", "waiting", "queued", "stopping"].contains(&t.status.as_str())
        })
    {
        return Err(if workspace {
            "请先停止此项目的任务和终端"
        } else {
            "请先停止当前任务和终端"
        }
        .into());
    }
    if state
        .children
        .lock()
        .unwrap()
        .keys()
        .any(|id| ids.contains(&id.as_str()))
        || state
            .ptys
            .lock()
            .unwrap()
            .keys()
            .any(|id| ids.contains(&id.as_str()))
    {
        return Err("进程尚未完全退出，请稍后再试".into());
    }
    Ok(())
}
fn target<'a>(detail: &'a TaskDetail, expected: &str, index: usize) -> Result<&'a Message, String> {
    if detail.revision != expected {
        return Err("对话已更新，请重新打开消息编辑".into());
    }
    if detail.task.parent_id.is_some()
        || detail.task.subagent_id.is_some()
        || ["terminal", "supervisor", "custom"].contains(&detail.task.agent_kind.as_str())
    {
        return Err("此会话不支持编辑历史消息".into());
    }
    let message = detail.messages.get(index).ok_or("消息不存在")?;
    if message.role != "user"
        || message.synthetic == Some(true)
        || message.tool.is_some()
        || message.parent_call_id.is_some()
        || message.delta
        || message.text.trim().is_empty()
    {
        return Err("只能编辑用户发送的完整消息".into());
    }
    if message.text.chars().count() >= 50000
        || detail
            .messages
            .get(index + 1)
            .is_some_and(|next| next.role == "user" && next.delta)
        || message.native_id.as_ref().is_some_and(|id| {
            detail
                .messages
                .iter()
                .filter(|other| other.role == "user" && other.native_id.as_ref() == Some(id))
                .count()
                != 1
        })
    {
        return Err("这条消息包含截断或多个内容块，请在原生客户端编辑".into());
    }
    Ok(message)
}
fn agent(state: &AppState, task: &Task) -> Result<Agent, String> {
    state
        .db
        .lock()
        .unwrap()
        .agents
        .iter()
        .filter(|a| a.available && !a.custom && a.kind == task.agent_kind)
        .min_by_key(|a| a.id != task.agent_id)
        .cloned()
        .ok_or("请先安装或启用对应的 Agent 程序".into())
}
#[tauri::command]
pub async fn prepare_message_edit(
    app: tauri::AppHandle,
    id: String,
    revision: String,
    index: usize,
    inspect_files: Option<bool>,
) -> Result<Prepared, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let gate = crate::followup::task_gate(&state, &id);
        let _gate = gate.lock().map_err(|e| e.to_string())?;
        let _project = state.project_lock.lock().map_err(|e| e.to_string())?;
        let detail = crate::detail_inner(&app, &id)?;
        let message = target(&detail, &revision, index)?;
        idle(&state, &detail.task, false)?;
        let agent = agent(&state, &detail.task)?;
        let rewind = idle(&state, &detail.task, true).and_then(|_| {
            file_rewind::anchor(&detail.task, message, &agent)?;
            if inspect_files.unwrap_or(false) {
                file_rewind::inspect(&state, &detail.task, message, &agent).map(Some)
            } else {
                Ok(None)
            }
        });
        Ok(match rewind {
            Ok(preview) => Prepared {
                rewind: preview,
                rewind_unavailable: None,
            },
            Err(error) => Prepared {
                rewind: None,
                rewind_unavailable: Some(error),
            },
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
fn prefix_context(detail: &TaskDetail, index: usize, text: &str) -> Result<String, String> {
    let context = if index == 0 {
        text.to_owned()
    } else {
        crate::llm_prompts::handoff(json!({
            "project": detail.task.project,
            "previousContext": &detail.messages[..index],
            "newInstruction": text,
            "historyBoundary": "The following instruction replaces the next user turn. No later turns are included. This is a fresh session, not a native session resume. Recheck current files: historical edits may still exist unless explicitly restored."
        }))
    };
    let limit = if cfg!(windows) { 16000 } else { 100000 };
    if context.len() > limit {
        return Err("此前对话超过安全传递长度，请从更早的消息新建分支".into());
    }
    Ok(context)
}
#[tauri::command]
pub async fn edit_message(app: tauri::AppHandle, input: EditInput) -> Result<Edited, String> {
    tauri::async_runtime::spawn_blocking(move || edit_inner(app, input))
        .await
        .map_err(|e| e.to_string())?
}
pub(crate) fn edit_inner<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    input: EditInput,
) -> Result<Edited, String> {
    if !["branch", "replace"].contains(&input.mode.as_str()) || input.text.trim().is_empty() {
        return Err("请输入消息并选择编辑方式".into());
    }
    if crate::commands::slash(&input.text).is_some() {
        return Err("历史消息编辑不能执行斜杠命令".into());
    }
    uuid::Uuid::parse_str(&input.request_id).map_err(|_| "编辑请求标识无效")?;
    let fingerprint = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                &input.id,
                &input.revision,
                input.index,
                &input.text,
                &input.mode,
                &input.rewind_token
            ))
            .map_err(|e| e.to_string())?
        )
    );
    let state = app.state::<AppState>();
    let gate = crate::followup::task_gate(&state, &input.id);
    let _gate = gate.lock().map_err(|e| e.to_string())?;
    let project_guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    {
        let db = state.db.lock().unwrap();
        if let Some(edit) = db.conversation_edits.get(&input.request_id) {
            if edit.fingerprint != fingerprint {
                return Err("编辑请求已提交，请重新打开编辑器".into());
            }
            return db
                .tasks
                .iter()
                .find(|task| task.id == edit.task_id)
                .cloned()
                .map(|task| Edited {
                    task,
                    launch_error: None,
                })
                .ok_or("编辑后的会话已删除".into());
        }
    }
    let detail = crate::detail_inner(&app, &input.id)?;
    let message = target(&detail, &input.revision, input.index)?;
    idle(&state, &detail.task, input.rewind_token.is_some())?;
    let agent = agent(&state, &detail.task)?;
    crate::discovery::resolve(&agent.executable).ok_or("找不到 Agent 程序")?;
    let project = dunce::canonicalize(&detail.task.project).map_err(|_| "项目目录不存在")?;
    if !project.is_dir() {
        return Err("项目路径不是文件夹".into());
    }
    let permission = crate::launch::permission(&agent.kind, &detail.task.permission)?;
    let env = crate::launch::environment(&state, &detail.task)?;
    crate::launch::validate(&detail.task.extra_args, &env)?;
    crate::launch::validate_protocol(&agent.kind, &detail.task.extra_args)?;
    crate::providers::environment(&state, &detail.task)?;
    let context = prefix_context(&detail, input.index, &input.text)?;
    let mut task = detail.task.clone();
    task.id = uuid::Uuid::new_v4().to_string();
    task.agent_id = agent.id.clone();
    task.permission = permission;
    task.project = project.to_string_lossy().into();
    task.title = if input.mode == "branch" {
        format!("{} · 分支", task.title)
    } else {
        task.title
    };
    task.prompt = input.text.trim().into();
    task.status = "queued".into();
    task.source = "managed".into();
    task.created_at = now();
    task.updated_at = task.created_at.clone();
    task.preview = "等待启动".into();
    task.session_id = None;
    task.sessions.clear();
    task.session_usage = None;
    task.usage = Usage::default();
    task.usage_by_agent.clear();
    task.terminal_id = None;
    task.terminal_cursor = None;
    task.queued_messages.clear();
    task.active_prompt = None;
    task.context_handoff = false;
    task.parent_id = None;
    task.subagent_id = None;
    task.subagent_name = None;
    task.history_path = None;
    task.archived = false;
    task.exit_code = None;
    let log = state
        .dir
        .join("logs")
        .join(format!("{}.messages.jsonl", task.id));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&log)
        .map_err(|e| e.to_string())?;
    for original in &detail.messages[..input.index] {
        let mut message = original.clone();
        message.native_id = None;
        writeln!(
            file,
            "{}",
            serde_json::to_string(&message).map_err(|e| e.to_string())?
        )
        .map_err(|e| e.to_string())?;
    }
    file.sync_all().map_err(|e| e.to_string())?;
    if let Some(token) = input.rewind_token.as_deref() {
        if let Err(error) = file_rewind::apply(
            &state,
            &detail.task,
            message,
            &agent,
            token,
            &input.request_id,
        ) {
            let _ = fs::remove_file(log);
            return Err(error);
        }
    }
    let archived = {
        let mut db = state.db.lock().unwrap();
        let mut next = db.clone();
        crate::temporary_projects::check_available(&next, &task.project)?;
        next.tasks.push(task.clone());
        if next.titles.contains_key(&input.id) {
            next.titles.insert(task.id.clone(), task.title.clone());
        }
        let archived = if input.mode == "replace" {
            if !next.archived.contains(&input.id) {
                next.archived.push(input.id.clone());
            }
            next.tasks
                .iter_mut()
                .find(|t| t.id == input.id)
                .map(|source| {
                    source.archived = true;
                    source.updated_at = now();
                    source.clone()
                })
        } else {
            None
        };
        next.conversation_edits.insert(
            input.request_id.clone(),
            EditRecord {
                task_id: task.id.clone(),
                source_id: input.id,
                fingerprint,
                context,
            },
        );
        state.save(&next)?;
        *db = next;
        archived
    };
    state
        .launch_envs
        .lock()
        .unwrap()
        .insert(task.id.clone(), env);
    if let Some(source) = archived {
        crate::runtime::emit(&app, &source);
    }
    crate::runtime::emit(&app, &task);
    drop(project_guard);
    let result = crate::runtime::start(app.clone(), task.id.clone());
    match result {
        Ok(task) => Ok(Edited {
            task,
            launch_error: None,
        }),
        Err(error) => {
            let task = state.update(&task.id, |task| {
                task.status = "failed".into();
                task.preview = error.clone();
            })?;
            crate::runtime::emit(&app, &task);
            Ok(Edited {
                task,
                launch_error: Some(error),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> Task {
        serde_json::from_value(json!({"id":"source", "title":"Original", "prompt":"old", "project":"/tmp", "agentId":"codex", "agentKind":"codex", "status":"completed", "createdAt":"t", "updatedAt":"t", "preview":"done", "usage":{"input":20,"output":4,"cached":0,"known":true}, "source":"managed", "model":"", "permission":"workspace-write", "sessionId":"old-native", "exitCode":0})).unwrap()
    }
    fn message(role: &str, text: &str) -> Message {
        serde_json::from_value(
            json!({"role":role,"text":text,"timestamp":"t","nativeId":format!("old-native-{text}")}),
        )
        .unwrap()
    }
    fn detail() -> TaskDetail {
        let task = source();
        let messages = vec![
            message("user", "first"),
            message("assistant", "previous answer"),
            message("user", "old prompt"),
            message("assistant", "FUTURE_SECRET"),
        ];
        TaskDetail {
            revision: revision(&task, &messages),
            task,
            messages,
            log: String::new(),
        }
    }
    #[test]
    fn prefix_excludes_replaced_turn_and_future_and_rejects_oversized_history() {
        let mut d = detail();
        let context = prefix_context(&d, 2, "replacement").unwrap();
        assert!(context.contains("previous answer") && context.contains("replacement"));
        assert!(!context.contains("FUTURE_SECRET") && !context.contains("old prompt"));
        assert_eq!(
            prefix_context(&d, 0, "first replacement").unwrap(),
            "first replacement"
        );
        assert!(prefix_context(&d, 0, &"x".repeat(110000)).is_err());
        d.messages[0].text = "x".repeat(110000);
        assert!(prefix_context(&d, 2, "replacement").is_err());
    }
    #[test]
    fn rejects_stale_revision_and_non_user_or_synthetic_targets() {
        let mut d = detail();
        let original = d.revision.clone();
        assert!(target(&d, &original, 2).is_ok());
        assert!(target(&d, "stale", 2).is_err());
        assert!(target(&d, &original, 1).is_err());
        assert!(target(&d, &original, 20).is_err());
        d.messages[2].synthetic = Some(true);
        assert!(target(&d, &original, 2).is_err());
        assert_ne!(revision(&d.task, &d.messages), original);
    }
    #[cfg(unix)]
    #[test]
    fn edit_is_idempotent_preserves_original_and_clears_native_context() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let dir = tempfile::tempdir().unwrap();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        app.manage(AppState::load(dir.path().join("app")).unwrap());
        let state = app.state::<AppState>();
        let mut task = source();
        task.project = dir.path().canonicalize().unwrap().to_string_lossy().into();
        {
            let mut db = state.db.lock().unwrap();
            db.agents.push(Agent {
                id: "codex".into(),
                name: "fixture".into(),
                kind: "codex".into(),
                executable: "/usr/bin/false".into(),
                args: vec![],
                available: true,
                version: String::new(),
                custom: false,
            });
            db.tasks.push(task.clone());
            state.save(&db).unwrap();
        }
        for message in detail().messages {
            crate::runtime::append_record(&state, &task.id, &message);
        }
        let original = fs::read(state.dir.join("logs/source.messages.jsonl")).unwrap();
        let d = crate::detail_inner(app.handle(), &task.id).unwrap();
        let request = uuid::Uuid::new_v4().to_string();
        let input = || EditInput {
            id: task.id.clone(),
            revision: d.revision.clone(),
            index: 2,
            text: "replacement".into(),
            mode: "replace".into(),
            request_id: request.clone(),
            rewind_token: None,
        };
        let edited = edit_inner(app.handle().clone(), input()).unwrap();
        let repeated = edit_inner(app.handle().clone(), input()).unwrap();
        assert_eq!(edited.task.id, repeated.task.id);
        assert!(edited.task.session_id.is_none() && edited.task.sessions.is_empty());
        let db = state.db.lock().unwrap();
        assert_eq!(db.tasks.len(), 2);
        assert!(db.tasks[0].archived);
        assert!(!db.conversation_edits[&request]
            .context
            .contains("FUTURE_SECRET"));
        drop(db);
        assert_eq!(
            fs::read(state.dir.join("logs/source.messages.jsonl")).unwrap(),
            original
        );
        let updated = crate::detail_inner(app.handle(), &edited.task.id).unwrap();
        assert_eq!(updated.messages[0].native_id, None);
        assert!(!updated
            .messages
            .iter()
            .any(|m| m.text.contains("FUTURE_SECRET")));
        let mut changed = input();
        changed.text = "different".into();
        assert!(edit_inner(app.handle().clone(), changed).is_err());
        // Wait for the test child to be reaped before removing its workspace.
        for _ in 0..100 {
            if !state.children.lock().unwrap().contains_key(&edited.task.id) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
    #[test]
    fn rejects_stopping_and_other_active_project_tasks_before_rewind() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let mut task = source();
        task.status = "stopping".into();
        assert!(idle(&state, &task, false).is_err());
        task.status = "completed".into();
        let mut other = task.clone();
        other.id = "other".into();
        other.status = "running".into();
        state.db.lock().unwrap().tasks.push(other);
        assert!(idle(&state, &task, false).is_ok());
        assert!(idle(&state, &task, true).is_err());
    }
}
