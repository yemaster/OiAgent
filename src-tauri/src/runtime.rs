use crate::{
    discovery,
    history::{short, string, text_content, usage},
    models::*,
    store::AppState,
};
#[cfg(test)]
use serde_json::json;
use serde_json::Value;
use std::{
    fs::OpenOptions,
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::Duration,
};
use tauri::{Emitter, Manager};

pub fn arguments(agent: &Agent, task: &Task) -> Vec<String> {
    let mode = crate::launch::permission(&agent.kind, &task.permission)
        .unwrap_or_else(|_| task.permission.clone());
    let mut a = Vec::<String>::new();
    match agent.kind.as_str() {
        "codex" => {
            a.extend(
                [
                    "exec",
                    "--json",
                    "--color",
                    "never",
                    "--skip-git-repo-check",
                    "--sandbox",
                    &mode,
                ]
                .map(String::from),
            );
            if !task.model.is_empty() {
                a.extend(["--model".into(), task.model.clone()]);
            }
            if let Some(s) = &task.session_id {
                a.extend(["resume".into(), s.clone()]);
            }
            a.push(task.prompt.clone());
        }
        "claude" => {
            a.extend(
                [
                    "-p",
                    "--verbose",
                    "--output-format",
                    "stream-json",
                    "--permission-mode",
                    &mode,
                ]
                .map(String::from),
            );
            if !task.model.is_empty() {
                a.extend(["--model".into(), task.model.clone()]);
            }
            if let Some(s) = &task.session_id {
                a.extend(["--resume".into(), s.clone()]);
            }
            a.extend(["--".into(), task.prompt.clone()]);
        }
        "qwen" => {
            a.extend(
                ["--output-format", "stream-json", "--approval-mode", &mode].map(String::from),
            );
            if !task.model.is_empty() {
                a.extend(["--model".into(), task.model.clone()]);
            }
            if let Some(s) = &task.session_id {
                a.extend(["--resume".into(), s.clone()]);
            }
            a.extend(["-p".into(), task.prompt.clone()]);
        }
        "gemini" => {
            a.extend(
                ["--output-format", "stream-json", "--approval-mode", &mode].map(String::from),
            );
            if !task.model.is_empty() {
                a.extend(["--model".into(), task.model.clone()]);
            }
            if let Some(s) = &task.session_id {
                a.extend(["--resume".into(), s.clone()]);
            }
            a.extend(["--prompt".into(), task.prompt.clone()]);
        }
        "opencode" => {
            a.extend(["run", "--format", "json", "--agent", &mode].map(String::from));
            if !task.model.is_empty() {
                a.extend(["--model".into(), task.model.clone()]);
            }
            if let Some(s) = &task.session_id {
                a.extend(["--session".into(), s.clone()]);
            }
            a.extend(["--".into(), task.prompt.clone()]);
        }
        "aider" => {
            a.extend(
                [
                    "--no-pretty",
                    "--no-stream",
                    "--no-auto-commits",
                    "--no-dirty-commits",
                ]
                .map(String::from),
            );
            a.extend(["--chat-mode".into(), mode.clone()]);
            if !task.model.is_empty() {
                a.extend(["--model".into(), task.model.clone()]);
            }
            a.extend(["--message".into(), task.prompt.clone()]);
        }
        "goose" => {
            a.extend(["run", "--output-format", "text"].map(String::from));
            if !task.model.is_empty() {
                a.extend(["--model".into(), task.model.clone()]);
            }
            a.extend(["--text".into(), task.prompt.clone()]);
        }
        _ => {
            let mut replaced = false;
            for arg in &agent.args {
                if arg.contains("{prompt}") {
                    replaced = true;
                }
                a.push(
                    arg.replace("{prompt}", &task.prompt)
                        .replace("{project}", &task.project),
                );
            }
            if !replaced {
                a.push(task.prompt.clone());
            }
        }
    }
    let index = match agent.kind.as_str() {
        "codex" => a.len().saturating_sub(1),
        "claude" | "qwen" | "gemini" | "opencode" | "aider" | "goose" => a.len().saturating_sub(2),
        _ => 0,
    };
    a.splice(index..index, task.extra_args.clone());
    a
}
pub fn create(state: &AppState, input: TaskInput, parent: Option<String>) -> Result<Task, String> {
    let _project_guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    if input.prompt.trim().is_empty() {
        return Err("请输入任务内容".into());
    }
    crate::launch::validate(&input.extra_args, &input.env)?;
    let project = std::fs::canonicalize(&input.project).map_err(|_| "项目目录不存在")?;
    if !project.is_dir() {
        return Err("请选择文件夹".into());
    }
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    crate::temporary_projects::check_available(&db, &project.to_string_lossy())?;
    let agent = db
        .agents
        .iter()
        .find(|a| a.id == input.agent_id && a.available)
        .ok_or("Agent 不可用，请先扫描或添加程序")?
        .clone();
    if let Some(id) = &input.provider_id {
        if agent.kind != "claude" || !db.providers.iter().any(|p| &p.id == id) {
            return Err("请选择有效的 Claude Code API 配置".into());
        }
    }
    crate::launch::validate_protocol(&agent.kind, &input.extra_args)?;
    let permission = crate::launch::permission(&agent.kind, &input.permission)?;
    let time = now();
    let task = Task {
        terminal_cursor: None,
        context_handoff: false,
        provider_id: input.provider_id,
        sessions: vec![],
        usage_by_agent: Default::default(),
        extra_args: input.extra_args,
        env_keys: input.env.keys().cloned().collect(),
        queued_messages: vec![],
        active_prompt: None,
        terminal_id: None,
        id: uuid::Uuid::new_v4().to_string(),
        title: if input.title.trim().is_empty() {
            short(&input.prompt, 70)
        } else {
            input.title
        },
        prompt: input.prompt,
        project: project.to_string_lossy().into(),
        agent_id: agent.id,
        agent_kind: agent.kind,
        status: "queued".into(),
        created_at: time.clone(),
        updated_at: time,
        preview: "等待启动".into(),
        usage: Usage::default(),
        session_usage: None,
        session_id: input.resume_session,
        source: "managed".into(),
        model: input.model,
        permission,
        exit_code: None,
        history_path: None,
        parent_id: parent,
        subagent_id: None,
        subagent_name: None,
        archived: false,
    };
    if !db.projects.contains(&task.project) {
        db.projects.push(task.project.clone());
    }
    db.tasks.push(task.clone());
    crate::temporary_projects::update_expiry(&mut db, chrono::Utc::now());
    state.save(&db)?;
    drop(db);
    state
        .launch_envs
        .lock()
        .unwrap()
        .insert(task.id.clone(), input.env);
    if let Some(id) = task.session_id.as_deref() {
        let native = state
            .history
            .lock()
            .unwrap()
            .find_session(&task.agent_kind, id);
        if let Some(native) = native {
            if let Some(path) = native.history_path {
                if let Ok((_, messages)) =
                    crate::history::parse_file(std::path::Path::new(&path), &task.agent_kind, true)
                {
                    for m in messages {
                        append_record(state, &task.id, &m);
                    }
                }
            }
        }
    }
    Ok(task)
}
pub fn emit<R: tauri::Runtime>(app: &tauri::AppHandle<R>, task: &Task) {
    let _ = app.emit("task-changed", task);
}
pub fn append_message(state: &AppState, id: &str, role: &str, text: &str) {
    append_record(
        state,
        id,
        &Message {
            agent_kind: None,
            role: role.into(),
            text: text.into(),
            timestamp: now(),
            tool: None,
            parent_call_id: None,
            delta: false,
        },
    );
}
pub(crate) fn append_record(state: &AppState, id: &str, message: &Message) {
    let mut message = message.clone();
    if message.agent_kind.is_none() {
        message.agent_kind = state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.id == id)
            .map(|t| t.agent_kind.clone());
    }
    if let Ok(mut f) = OpenOptions::new()
        .append(true)
        .create(true)
        .open(state.dir.join("logs").join(format!("{id}.messages.jsonl")))
    {
        if let Ok(line) = serde_json::to_string(&message) {
            let _ = writeln!(f, "{line}");
        }
    }
}

#[derive(Default)]
struct StreamState {
    prior_usage: Usage,
    prior_agent_usage: Usage,
    usage: Usage,
    by_message: std::collections::HashMap<String, Usage>,
    failed: bool,
    waiting: bool,
}
fn consume<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    line: &str,
    stderr: bool,
    stream: &Mutex<StreamState>,
) {
    let state = app.state::<AppState>();
    if let Ok(mut f) = OpenOptions::new()
        .append(true)
        .create(true)
        .open(state.log_path(id))
    {
        let _ = writeln!(f, "{line}");
    }
    let parsed = serde_json::from_str::<Value>(line).ok();
    let plain_output = parsed.is_none();
    let records = parsed
        .as_ref()
        // Gemini echoes the prompt already persisted when the task starts.
        .filter(|v| !(v["type"] == "message" && v["role"] == "user"))
        .map(|v| crate::transcript::messages(v, &now()))
        .unwrap_or_default();
    let mut s = stream.lock().unwrap();
    let mut text = String::new();
    let mut role = "assistant";
    let mut sid = None;
    if let Some(v) = parsed {
        let typ = string(&v, "type");
        if typ == "thread.started" {
            sid = v["thread_id"].as_str().map(String::from);
        }
        if v["session_id"].is_string() {
            sid = v["session_id"].as_str().map(String::from);
        }
        if v["sessionID"].is_string() {
            sid = v["sessionID"].as_str().map(String::from);
        }
        if typ == "step_finish" && v["part"]["tokens"].is_object() {
            let u = &v["part"]["tokens"];
            let next = Usage {
                input: u["input"].as_u64().unwrap_or(0)
                    + u["cache"]["read"].as_u64().unwrap_or(0)
                    + u["cache"]["write"].as_u64().unwrap_or(0),
                output: u["output"].as_u64().unwrap_or(0) + u["reasoning"].as_u64().unwrap_or(0),
                cached: u["cache"]["read"].as_u64().unwrap_or(0),
                known: true,
            };
            s.by_message.insert(string(&v["part"], "id"), next);
            s.usage = Usage::default();
            for u in s.by_message.values().cloned().collect::<Vec<_>>() {
                s.usage.add(&u);
            }
        }
        if typ == "item.completed" {
            let item = &v["item"];
            if item["type"] == "agent_message" {
                text = string(item, "text");
            }
        }

        if typ == "assistant" {
            text = text_content(&v["message"]["content"]);
            if text.is_empty() {
                text = text_content(&v["message"]["parts"]);
            }
            if v["message"]["usage"].is_object() {
                let key = string(&v["message"], "id");
                let u = usage(&v["message"]["usage"]);
                s.by_message.insert(key, u);
                s.usage = Usage::default();
                let us: Vec<_> = s.by_message.values().cloned().collect();
                for u in us {
                    s.usage.add(&u);
                }
            }
        }
        if typ == "turn.completed" {
            s.usage.add(&usage(&v["usage"]));
        }
        if typ == "result" {
            if v["stats"].is_object() {
                s.usage = usage(&v["stats"]);
                s.usage.cached = v["stats"]["cached"].as_u64().unwrap_or(0);
            }
            if v["status"] == "error" {
                s.failed = true;
                text = string(&v["error"], "message");
            }

            if v["usage"].is_object() {
                s.usage = usage(&v["usage"]);
            }
            if v["permission_denials"]
                .as_array()
                .is_some_and(|a| !a.is_empty())
            {
                s.waiting = true;
                text = "有工具权限请求未获批准，请查看日志并使用交互终端处理。".into();
                role = "system";
            }
            if v["is_error"] == true {
                s.failed = true;
                text = string(&v, "result");
                if text.is_empty() {
                    text = v["errors"].to_string();
                }
            }
        }
        if typ == "error" || typ == "turn.failed" {
            s.failed |= v["severity"] != "warning";
            role = "system";
            text = v
                .get("error")
                .map(|e| {
                    e.as_str().map(String::from).unwrap_or_else(|| {
                        let msg = string(e, "message");
                        if msg.is_empty() {
                            string(&e["data"], "message")
                        } else {
                            msg
                        }
                    })
                })
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| string(&v, "message"));
        }
        if typ == "control_request" {
            s.waiting = true;
            text = "Agent 请求交互操作，请使用交互终端处理权限或输入。".into();
        }
    } else if !line.trim().is_empty() {
        text = line.to_string();
        if stderr {
            role = "system";
        }
    }
    for record in &records {
        append_record(&state, id, record);
    }
    if !text.is_empty()
        && !records
            .iter()
            .any(|m| m.role == role && m.tool.is_none() && !m.text.is_empty())
    {
        append_record(
            &state,
            id,
            &Message {
                agent_kind: None,
                role: role.into(),
                text: if plain_output && !stderr {
                    format!("{text}\n")
                } else {
                    text.clone()
                },
                timestamp: now(),
                tool: None,
                parent_call_id: None,
                delta: plain_output && !stderr,
            },
        );
    }
    if text.is_empty() {
        if let Some(message) = records.iter().rev().find(|m| m.role == "assistant") {
            text = message.text.clone();
        }
    }
    if stderr && line.contains("permission requested:") && line.contains("auto-rejecting") {
        s.waiting = true;
    }
    let mut next_usage = s.prior_usage.clone();
    next_usage.add(&s.usage);
    let waiting = s.waiting;
    // Streaming snapshots stay in memory; durable state is flushed on state transitions.
    if let Ok(mut db) = state.db.lock() {
        if let Some(t) = db.tasks.iter_mut().find(|t| t.id == id) {
            if t.status == "cancelled" {
                return;
            }
            if let Some(sid) = sid {
                t.session_id = Some(sid.clone());
                t.sessions
                    .retain(|s| !(s.agent_id == t.agent_id && s.provider_id == t.provider_id));
                t.sessions.push(AgentSession {
                    agent_id: t.agent_id.clone(),
                    agent_kind: t.agent_kind.clone(),
                    provider_id: t.provider_id.clone(),
                    session_id: sid,
                });
            }
            let mut agent_usage = s.prior_agent_usage.clone();
            agent_usage.add(&s.usage);
            t.usage_by_agent.insert(t.agent_kind.clone(), agent_usage);
            t.usage = next_usage;
            if !text.is_empty() {
                t.preview = short(&text, 240);
            }
            t.updated_at = now();
            if waiting {
                t.status = "waiting".into();
            }
            emit(app, t);
        }
    };
}
pub fn start<R: tauri::Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<Task, String> {
    let state = app.state::<AppState>();
    let _project_guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    let mut registry = state.children.lock().map_err(|e| e.to_string())?;
    if registry.contains_key(&id) {
        return Err("任务已在运行".into());
    }
    let (task, agent) = {
        let db = state.db.lock().unwrap();
        let task = db
            .tasks
            .iter()
            .find(|t| t.id == id)
            .ok_or("任务不存在")?
            .clone();
        crate::temporary_projects::check_available(&db, &task.project)?;
        if task.status != "queued" {
            return Err("只能启动排队中的任务".into());
        }
        let agent = db
            .agents
            .iter()
            .find(|a| a.id == task.agent_id)
            .ok_or("Agent 不存在")?
            .clone();
        (task, agent)
    };
    let env = crate::launch::environment(&state, &task)?;
    let mut invocation = task.clone();
    if let Some(prompt) = &task.active_prompt {
        invocation.prompt = prompt.clone();
        if task.context_handoff
            || !crate::launch::resumable(&task.agent_kind)
            || task.session_id.is_none()
        {
            invocation.prompt = crate::followup::context(&state, &task, prompt);
            if !crate::launch::resumable(&task.agent_kind) {
                invocation.session_id = None;
            }
        }
    }

    let executable = discovery::resolve(&agent.executable).ok_or("找不到可执行文件")?;
    let mut command = Command::new(executable);
    command
        .args(arguments(&agent, &invocation))
        .current_dir(&task.project)
        .env("PATH", discovery::path_env())
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if agent.kind == "goose" {
        command.env(
            "GOOSE_MODE",
            crate::launch::permission("goose", &task.permission)?,
        );
    }
    command.envs(env);
    command.envs(crate::providers::environment(&state, &task)?);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = match command.spawn() {
        Ok(c) => c,
        Err(e) => {
            let t = state.update(&id, |t| {
                t.status = "failed".into();
                t.preview = e.to_string();
            })?;
            emit(&app, &t);
            return Err(e.to_string());
        }
    };
    let out = child.stdout.take().unwrap();
    let err = child.stderr.take().unwrap();
    let child = Arc::new(Mutex::new(child));
    registry.insert(id.clone(), child.clone());
    drop(registry);
    if task.context_handoff {
        append_message(
            &state,
            &id,
            "handoff",
            &format!("{} 已接手续聊，携带最近对话与执行记录。", agent.name),
        );
    }
    append_message(
        &state,
        &id,
        "user",
        task.active_prompt.as_deref().unwrap_or(&task.prompt),
    );
    let running = state.update(&id, |t| {
        t.status = "running".into();
        t.preview = "Agent 已启动".into();
    })?;
    emit(&app, &running);
    drop(_project_guard);
    std::thread::spawn(move || {
        let stream = Arc::new(Mutex::new(StreamState {
            prior_agent_usage: task
                .usage_by_agent
                .get(&task.agent_kind)
                .cloned()
                .unwrap_or_else(|| {
                    if task.usage_by_agent.is_empty() {
                        task.usage.clone()
                    } else {
                        Usage::default()
                    }
                }),
            prior_usage: task.usage.clone(),
            ..Default::default()
        }));
        let app_out = app.clone();
        let id_out = id.clone();
        let st = stream.clone();
        let reader = std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                consume(&app_out, &id_out, &line, false, &st);
            }
        });
        let app_err = app.clone();
        let id_err = id.clone();
        let st = stream.clone();
        let reader_err = std::thread::spawn(move || {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                consume(&app_err, &id_err, &line, true, &st);
            }
        });
        let exit = loop {
            let status = { child.lock().unwrap().try_wait() };
            match status {
                Ok(Some(e)) => break Some(e),
                Err(_) => break None,
                _ => std::thread::sleep(Duration::from_millis(100)),
            }
        };
        let _ = reader.join();
        let _ = reader_err.join();
        let state = app.state::<AppState>();
        let s = stream.lock().unwrap();
        state.children.lock().unwrap().remove(&id);
        if let Ok(t) = state.update(&id, |t| {
            if t.status != "cancelled" {
                t.status = if s.waiting {
                    "waiting"
                } else if exit.is_some_and(|e| e.success()) && !s.failed {
                    "completed"
                } else {
                    "failed"
                }
                .into();
            }
            t.exit_code = exit.and_then(|e| e.code());
        }) {
            emit(&app, &t);
        }
        drop(s);
        let _ = crate::followup::dispatch(app.clone(), &id, false);
    });
    Ok(running)
}
pub fn cancel<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) -> Result<Task, String> {
    let state = app.state::<AppState>();
    {
        let db = state.db.lock().unwrap();
        let task = db.tasks.iter().find(|t| t.id == id).ok_or("任务不存在")?;
        if !["queued", "running", "waiting"].contains(&task.status.as_str()) {
            return Err("任务已结束，无需停止".into());
        }
    }
    let t = state.update(id, |t| {
        t.status = "cancelled".into();
        t.preview = "任务已停止".into();
    })?;
    if let Some(child) = state.children.lock().unwrap().get(id) {
        let mut c = child.lock().unwrap();
        #[cfg(unix)]
        unsafe {
            libc::kill(-(c.id() as i32), libc::SIGKILL);
        }
        let _ = c.kill();
    }
    emit(app, &t);
    Ok(t)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn custom_prompt_is_one_argument_not_shell_code() {
        let a = Agent {
            id: "a".into(),
            name: "a".into(),
            kind: "custom".into(),
            executable: "echo".into(),
            args: vec!["--prompt".into(), "{prompt}".into()],
            available: true,
            version: String::new(),
            custom: true,
        };
        let t:Task=serde_json::from_value(json!({"id":"t","title":"t","prompt":"$(touch /tmp/bad) ; hello","project":"/tmp","agentId":"a","agentKind":"custom","status":"queued","createdAt":"","updatedAt":"","preview":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"read-only","exitCode":null,"sessionId":null})).unwrap();
        assert_eq!(
            arguments(&a, &t),
            vec!["--prompt", "$(touch /tmp/bad) ; hello"]
        );
    }
    #[test]
    fn builtins_have_explicit_prompt_and_permission_contracts() {
        let mut task: Task = serde_json::from_value(json!({"id":"t","title":"t","prompt":"quoted ' prompt $(echo x)","project":"/tmp","agentId":"x","agentKind":"x","status":"queued","createdAt":"","updatedAt":"","preview":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"test-model","permission":"read-only","exitCode":null,"sessionId":null})).unwrap();
        for (kind, marker) in [
            ("gemini", "plan"),
            ("opencode", "plan"),
            ("aider", "ask"),
            ("goose", "--text"),
        ] {
            let agent = Agent {
                id: kind.into(),
                name: kind.into(),
                kind: kind.into(),
                executable: kind.into(),
                args: vec![],
                available: true,
                version: String::new(),
                custom: false,
            };
            let args = arguments(&agent, &task);
            assert_eq!(args.last(), Some(&task.prompt));
            assert!(args.contains(&marker.into()));
            assert!(args.contains(&"test-model".into()));
            assert!(!args.iter().any(|s| [
                "--yolo",
                "--yes-always",
                "--dangerously-skip-permissions"
            ]
            .contains(&s.as_str())));
            task.session_id = Some("resume-id".into());
            if kind == "gemini" || kind == "opencode" {
                assert!(arguments(&agent, &task).contains(&"resume-id".into()));
            }
            task.session_id = None;
        }
    }
}
