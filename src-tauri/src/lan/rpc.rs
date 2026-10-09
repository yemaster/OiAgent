use super::*;
use crate::{
    models::{Task, TaskInput},
    runtime,
};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
pub(super) fn supported(kind: &str) -> bool {
    [
        "codex", "claude", "qwen", "gemini", "opencode", "aider", "goose",
    ]
    .contains(&kind)
}
fn allowed_permission(kind: &str, permission: &str) -> bool {
    match kind {
        "codex" => ["read-only", "workspace-write"].contains(&permission),
        "claude" => ["plan", "default", "auto", "acceptEdits", "dontAsk"].contains(&permission),
        "qwen" => ["plan", "default", "auto-edit"].contains(&permission),
        "gemini" => ["plan", "default", "auto_edit"].contains(&permission),
        "opencode" => ["plan", "build"].contains(&permission),
        "aider" => ["ask", "code", "architect"].contains(&permission),
        "goose" => ["chat", "approve"].contains(&permission),
        _ => false,
    }
}
fn check_input(
    state: &AppState,
    inner: &Inner,
    grant: &Grant,
    input: &TaskInput,
) -> Result<(), String> {
    if !grant.allow_execution || !inner.saved.config.allow_execution {
        return Err("本机未授权远程执行".into());
    }
    let canonical = canonical_project(&input.project)?;
    // Exact canonical root, not prefix matching. Renames/symlinks cannot silently expand a grant.
    if canonical != input.project
        || !grant.projects.contains(&canonical)
        || !inner.saved.config.projects.contains(&canonical)
    {
        return Err("此项目未共享给该设备".into());
    }
    if !input.env.is_empty()
        || !input.extra_args.is_empty()
        || input.provider_id.is_some()
        || input.resume_session.is_some()
    {
        return Err("远程任务不允许自定义参数、环境变量、API 或会话路径".into());
    }
    if input.prompt.trim().is_empty()
        || input.prompt.len() > 48 * 1024
        || input.title.len() > 640
        || input.model.len() > 200
    {
        return Err("任务内容为空或过长".into());
    }
    let db = state.db.lock().unwrap();
    let agent = db
        .agents
        .iter()
        .find(|a| a.id == input.agent_id && a.available && !a.custom && a.args.is_empty())
        .ok_or("Agent 不可用")?;
    if !grant.agents.contains(&agent.id)
        || !inner.saved.config.agents.contains(&agent.id)
        || !allowed_permission(&agent.kind, &input.permission)
    {
        return Err("此 Agent 或执行权限未获授权".into());
    }
    Ok(())
}
fn owns(inner: &Inner, grant: &Grant, task: &Task) -> bool {
    inner.saved.owners.get(&task.id) == Some(&grant.id)
        && grant.projects.contains(&task.project)
        && inner.saved.config.projects.contains(&task.project)
}
fn public_task(task: &Task) -> Value {
    let mut v = serde_json::to_value(task).unwrap();
    for field in ["historyPath", "sessions", "terminalCursor", "envKeys"] {
        v.as_object_mut().unwrap().remove(field);
    }
    v
}
fn string(args: &Value, key: &str) -> Result<String, String> {
    args[key]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("缺少 {key}"))
}
pub(super) fn dispatch<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    lan: &LanState,
    inner: &mut Inner,
    grant: &Grant,
    command: &str,
    args: &Value,
) -> Result<Value, String> {
    let state = app.state::<AppState>();
    if command == "get_snapshot" {
        let db = state.db.lock().unwrap();
        let tasks: Vec<_> = db
            .tasks
            .iter()
            .filter(|t| owns(inner, grant, t))
            .map(|t| {
                let mut v = public_task(t);
                v["archived"] = json!(db.archived.contains(&t.id));
                v
            })
            .collect();
        let agents:Vec<_>=db.agents.iter().filter(|a|a.available&&!a.custom&&a.args.is_empty()&&grant.agents.contains(&a.id)&&inner.saved.config.agents.contains(&a.id)).map(|a|json!({"id":a.id,"name":a.name,"kind":a.kind,"version":a.version,"available":true,"custom":false,"executable":"","args":[]})).collect();
        return Ok(
            json!({"name":inner.saved.config.name,"allowExecution":grant.allow_execution&&inner.saved.config.allow_execution,"agents":agents,"tasks":tasks,"projects":grant.projects.iter().filter(|p|inner.saved.config.projects.contains(p)).collect::<Vec<_>>() }),
        );
    }
    if command == "create_task" {
        let mut input: TaskInput =
            serde_json::from_value(args["input"].clone()).map_err(|e| e.to_string())?;
        check_input(&state, inner, grant, &input)?;
        let queued = input.queued;
        input.queued = true;
        let active_count = {
            let db = state.db.lock().unwrap();
            db.tasks
                .iter()
                .filter(|t| {
                    owns(inner, grant, t)
                        && ["running", "waiting", "queued"].contains(&t.status.as_str())
                })
                .count()
        };
        if active_count >= 10 {
            return Err("该设备最多保留 10 个未结束任务".into());
        }
        let task = runtime::create(&state, input, None)?;
        inner.saved.owners.insert(task.id.clone(), grant.id.clone());
        if let Err(e) = lan.save(inner) {
            inner.saved.owners.remove(&task.id);
            let _ = runtime::cancel(app, &task.id);
            return Err(e);
        }
        let task = if queued {
            runtime::emit(app, &task);
            task
        } else {
            runtime::start(app.clone(), task.id)?
        };
        return Ok(public_task(&task));
    }
    if command == "delete_archived_tasks" {
        if !grant.allow_execution || !inner.saved.config.allow_execution {
            return Err("此设备仅有查看权限".into());
        }
        let ids: Vec<String> =
            serde_json::from_value(args["ids"].clone()).map_err(|_| "记录 ID 格式无效")?;
        let allowed = state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .filter(|t| owns(inner, grant, t))
            .map(|t| t.id.clone())
            .collect();
        return serde_json::to_value(crate::organization::delete_archived(
            &state,
            ids,
            Some(&allowed),
        )?)
        .map_err(|e| e.to_string());
    }
    // Unknown commands fail before looking up IDs and can never call arbitrary native commands.
    if ![
        "get_detail",
        "start_task",
        "stop_task",
        "queue_message",
        "remove_queued_message",
        "run_queued_messages",
        "rename_task",
        "archive_task",
    ]
    .contains(&command)
    {
        return Err("局域网不支持此操作".into());
    }
    let id = string(args, "id")?;
    let task = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .find(|t| t.id == id && owns(inner, grant, t))
        .cloned()
        .ok_or("任务不存在或无权访问")?;
    if command == "get_detail" {
        let path = state
            .dir
            .join("logs")
            .join(format!("{}.messages.jsonl", task.id));
        let messages: Vec<Value> = if let Ok(mut file) = std::fs::File::open(path) {
            let size = file.metadata().map_err(|e| e.to_string())?.len();
            let offset = size.saturating_sub(4 * 1024 * 1024);
            file.seek(SeekFrom::Start(offset))
                .map_err(|e| e.to_string())?;
            let mut reader = BufReader::new(file.take(4 * 1024 * 1024));
            if offset > 0 {
                let mut partial = String::new();
                let _ = reader.read_line(&mut partial);
            }
            reader
                .lines()
                .map_while(Result::ok)
                .filter_map(|s| serde_json::from_str(&s).ok())
                .collect()
        } else {
            vec![]
        };
        return Ok(
            json!({"task":public_task(&task),"messages":messages,"log":"远程对话按需同步最近 4 MB 的记录；完整记录保留在执行设备。"}),
        );
    }
    if !grant.allow_execution || !inner.saved.config.allow_execution {
        return Err("此设备仅有查看权限".into());
    }
    let base = TaskInput {
        title: task.title.clone(),
        prompt: task.prompt.clone(),
        project: task.project.clone(),
        agent_id: task.agent_id.clone(),
        model: task.model.clone(),
        permission: task.permission.clone(),
        queued: false,
        resume_session: None,
        provider_id: None,
        extra_args: vec![],
        env: Default::default(),
    };
    match command {
        "stop_task" => crate::stop_task(app.clone(), state, id).map(|t| public_task(&t)),
        "start_task" => {
            check_input(&state, inner, grant, &base)?;
            if !task.extra_args.is_empty()
                || !task.env_keys.is_empty()
                || task.provider_id.is_some()
            {
                return Err("任务启动配置已在本机变更，请在本机启动".into());
            }
            crate::start_task(app.clone(), id).map(|t| public_task(&t))
        }
        "queue_message" => {
            let input = TaskInput {
                prompt: string(args, "text")?,
                agent_id: string(args, "agentId")?,
                permission: string(args, "permission")?,
                model: args["model"].as_str().unwrap_or("").into(),
                provider_id: args["providerId"].as_str().map(str::to_owned),
                ..base
            };
            check_input(&state, inner, grant, &input)?;
            crate::followup::queue_message(
                app.clone(),
                state,
                id,
                input.prompt,
                input.agent_id,
                input.permission,
                input.model,
                None,
            )
            .map(|t| public_task(&t))
        }
        "remove_queued_message" => crate::followup::remove_queued_message(
            app.clone(),
            state,
            id,
            string(args, "messageId")?,
        )
        .map(|t| public_task(&t)),
        "run_queued_messages" => {
            for m in &task.queued_messages {
                check_input(
                    &state,
                    inner,
                    grant,
                    &TaskInput {
                        prompt: m.text.clone(),
                        agent_id: m.agent_id.clone(),
                        permission: m.permission.clone(),
                        model: m.model.clone(),
                        provider_id: m.provider_id.clone(),
                        ..base.clone()
                    },
                )?;
            }
            crate::followup::run_queued_messages(app.clone(), id)?;
            Ok(Value::Null)
        }
        "rename_task" => {
            crate::rename_task(state, id, string(args, "title")?)?;
            Ok(Value::Null)
        }
        "archive_task" => {
            crate::archive_task(
                state,
                id,
                args["archived"].as_bool().ok_or("缺少 archived")?,
            )?;
            Ok(Value::Null)
        }
        _ => Err("不支持的操作".into()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bypass_is_never_allowed() {
        for (kind, mode) in [
            ("codex", "danger-full-access"),
            ("claude", "bypassPermissions"),
            ("qwen", "yolo"),
            ("gemini", "yolo"),
            ("goose", "auto"),
            ("custom", "read-only"),
        ] {
            assert!(!allowed_permission(kind, mode));
        }
        assert!(allowed_permission("claude", "auto"));
        assert!(allowed_permission("codex", "workspace-write"));
    }
    #[test]
    fn unshared_projects_and_launch_overrides_are_rejected() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().canonicalize().unwrap();
        let state = AppState::load(path.join("app")).unwrap();
        let lan = LanState::load(path.join("app")).unwrap();
        let mut inner = lan.inner.lock().unwrap();
        let grant = Grant {
            id: "g".into(),
            name: "Test".into(),
            token_hash: "".into(),
            created_at: "".into(),
            projects: vec![path.to_string_lossy().into()],
            agents: vec!["codex".into()],
            allow_execution: true,
        };
        inner.saved.config.allow_execution = true;
        inner.saved.config.projects = grant.projects.clone();
        inner.saved.config.agents = grant.agents.clone();
        state.db.lock().unwrap().agents.push(crate::models::Agent {
            id: "codex".into(),
            name: "Codex".into(),
            kind: "codex".into(),
            executable: "codex".into(),
            args: vec![],
            available: true,
            version: "".into(),
            custom: false,
        });
        let mut input = TaskInput {
            title: "test".into(),
            prompt: "test".into(),
            project: path.to_string_lossy().into(),
            agent_id: "codex".into(),
            model: "".into(),
            permission: "read-only".into(),
            queued: true,
            resume_session: None,
            provider_id: None,
            extra_args: vec![],
            env: Default::default(),
        };
        assert!(check_input(&state, &inner, &grant, &input).is_ok());
        input
            .extra_args
            .push("--dangerously-bypass-approvals-and-sandbox".into());
        assert!(check_input(&state, &inner, &grant, &input).is_err());
        input.extra_args.clear();
        input.project = path.join("app").to_string_lossy().into();
        assert!(check_input(&state, &inner, &grant, &input).is_err());
    }
}
