use crate::{discovery, models::*, runtime, store::AppState};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::{
    io::{Read, Seek, SeekFrom, Write},
    sync::Mutex,
};
use tauri::{Manager, State};
pub struct PtySession {
    _settings: Option<tempfile::NamedTempFile>,
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Mutex<Box<dyn Write + Send>>,
    pub child: Mutex<Box<dyn Child + Send + Sync>>,
}
#[tauri::command]
pub fn terminal_start(
    app: tauri::AppHandle,
    state: State<AppState>,
    project: String,
    command: String,
) -> Result<Task, String> {
    launch(app, &state, project, command)
}
pub fn launch<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: &AppState,
    project: String,
    command: String,
) -> Result<Task, String> {
    let _project_guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    if state
        .shutting_down
        .load(std::sync::atomic::Ordering::Acquire)
    {
        return Err("应用正在退出".into());
    }
    crate::temporary_projects::check_available(&state.db.lock().unwrap(), &project)?;
    let project = dunce::canonicalize(&project).map_err(|_| "项目目录不存在")?;
    if !project.is_dir() {
        return Err("请选择文件夹".into());
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) {
            "powershell.exe".into()
        } else {
            "/bin/sh".into()
        }
    });
    let mut cmd = CommandBuilder::new(&shell);
    cmd.cwd(&project);
    cmd.env("PATH", discovery::path_env());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // A user-entered shell command is intentionally executed only in terminal mode.
    if !command.trim().is_empty() {
        cmd.arg(if cfg!(windows) { "-Command" } else { "-lc" });
        cmd.arg(&command);
    }
    let time = now();
    let task = Task {
        terminal_cursor: None,
        context_handoff: false,
        provider_id: None,
        sessions: vec![],
        usage_by_agent: Default::default(),
        extra_args: vec![],
        env_keys: vec![],
        queued_messages: vec![],
        active_prompt: None,
        terminal_id: None,
        id: uuid::Uuid::new_v4().to_string(),
        title: if command.is_empty() {
            "交互终端".into()
        } else {
            crate::history::short(&command, 70)
        },
        prompt: command,
        project: project.to_string_lossy().into(),
        agent_id: "terminal".into(),
        agent_kind: "terminal".into(),
        status: "running".into(),
        created_at: time.clone(),
        updated_at: time,
        preview: "终端已连接".into(),
        usage: Usage::default(),
        session_usage: None,
        session_id: None,
        source: "terminal".into(),
        model: String::new(),
        permission: "interactive".into(),
        exit_code: None,
        history_path: None,
        parent_id: None,
        subagent_id: None,
        subagent_name: None,
        archived: false,
    };
    spawn_terminal(app, state, task, cmd, None)
}
fn spawn_terminal<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: &AppState,
    task: Task,
    cmd: CommandBuilder,
    settings: Option<tempfile::NamedTempFile>,
) -> Result<Task, String> {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let path = state.dir.join("logs").join(format!("{}.pty", task.id));
    let file = std::fs::File::create(path).map_err(|e| e.to_string())?;
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = task.id.clone();
    let owner_id = task.parent_id.clone();

    state.ptys.lock().unwrap().insert(
        id.clone(),
        PtySession {
            _settings: settings,
            master: pair.master,
            writer: Mutex::new(writer),
            child: Mutex::new(child),
        },
    );
    {
        let mut db = state.db.lock().unwrap();
        if !db.projects.contains(&task.project) {
            db.projects.push(task.project.clone());
        }
        db.tasks.push(task.clone());
        if let Some(owner) = &task.parent_id {
            crate::temporary_projects::restore_group(&mut db, owner);
        }
        crate::temporary_projects::update_expiry(&mut db, chrono::Utc::now());
        if let Err(error) = state.save(&db) {
            db.tasks.retain(|t| t.id != task.id);
            drop(db);
            stop(state, &task.id);
            state.ptys.lock().unwrap().remove(&task.id);
            return Err(error);
        }
    }
    runtime::emit(&app, &task);
    std::thread::spawn(move || {
        let mut file = file;
        let mut buffer = [0u8; 8192];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 {
                break;
            }
            let _ = file.write_all(&buffer[..n]);
        }
        let state = app.state::<AppState>();
        let mut ptys = state.ptys.lock().unwrap();
        let exit = ptys
            .remove(&id)
            .and_then(|p| p.child.lock().unwrap().wait().ok());
        drop(ptys);
        if let Ok(t) = state.update(&id, |t| {
            if t.status == "stopping" {
                t.status = "cancelled".into();
            } else if t.status != "cancelled" {
                t.status = if exit.as_ref().is_some_and(|e| e.success()) {
                    "completed"
                } else {
                    "failed"
                }
                .into();
            }
            t.exit_code = exit.map(|e| e.exit_code() as i32);
            t.preview = "终端已退出".into();
        }) {
            runtime::emit(&app, &t);
        }
        sync_owner_status(&app, &id);
        if let Some(owner_id) = &owner_id {
            match crate::terminal_history::finish_owner(&state, owner_id, &id) {
                Ok(Some(owner)) => runtime::emit(&app, &owner),
                Ok(None) => {}
                Err(error) => eprintln!("终端会话同步失败：{error}"),
            }
        }
    });
    Ok(task)
}
#[tauri::command]
pub fn terminal_write(state: State<AppState>, id: String, data: String) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    let p = ptys.get(&id).ok_or("终端已退出")?;
    let mut w = p.writer.lock().unwrap();
    w.write_all(data.as_bytes())
        .and_then(|_| w.flush())
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn terminal_resize(
    state: State<AppState>,
    id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    let p = ptys.get(&id).ok_or("终端已退出")?;
    p.master
        .resize(PtySize {
            cols: cols.max(10),
            rows: rows.max(3),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn terminal_read(state: State<AppState>, id: String, offset: u64) -> Result<Vec<u8>, String> {
    if !state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .any(|t| t.id == id && t.source == "terminal")
    {
        return Err("终端不存在".into());
    }
    let mut f = std::fs::File::open(state.dir.join("logs").join(format!("{id}.pty")))
        .map_err(|e| e.to_string())?;
    f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
    let mut data = vec![];
    f.take(262144)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    Ok(data)
}
pub fn stop(state: &AppState, id: &str) {
    if let Some(p) = state.ptys.lock().unwrap().get(id) {
        #[cfg(unix)]
        {
            if let Some(group) = p.master.process_group_leader() {
                unsafe {
                    libc::kill(-group, libc::SIGHUP);
                }
            }
        }
        let mut child = p.child.lock().unwrap();
        #[cfg(windows)]
        if child.try_wait().ok().flatten().is_none() {
            if let Some(pid) = child.process_id() {
                crate::process::terminate_windows_tree(pid);
            }
        }
        let _ = child.kill();
    }
}

#[tauri::command]
pub async fn connect_agent_terminal(
    app: tauri::AppHandle,
    id: String,
    stop_current: bool,
) -> Result<Task, String> {
    tauri::async_runtime::spawn_blocking(move || connect(app, id, stop_current))
        .await
        .map_err(|e| e.to_string())?
}
pub(crate) fn connect<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    stop_current: bool,
) -> Result<Task, String> {
    let state = app.state::<AppState>();
    let gate = crate::followup::task_gate(&state, &id);
    let _task_guard = gate.lock().map_err(|e| e.to_string())?;
    let _project_guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    if state
        .shutting_down
        .load(std::sync::atomic::Ordering::Acquire)
    {
        return Err("应用正在退出".into());
    }
    let stored = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .find(|t| t.id == id)
        .cloned();
    let mut original = if let Some(task) = stored {
        task
    } else {
        let (tasks, _) = state.history.lock().unwrap().scan();
        tasks.into_iter().find(|t| t.id == id).ok_or("任务不存在")?
    };
    crate::temporary_projects::check_available(&state.db.lock().unwrap(), &original.project)?;
    if original.source == "terminal" {
        return Ok(original);
    }
    if original.subagent_id.is_some() {
        return Err("请从父会话打开终端，避免误续父 session ID".into());
    }
    if let Some(terminal_id) = &original.terminal_id {
        let existing = state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| &t.id == terminal_id)
            .cloned();
        let attached = state.ptys.lock().unwrap().contains_key(terminal_id);
        if attached {
            if let Some(existing) = existing {
                if existing.status == "running" && original.status != "stopping" {
                    return Ok(existing);
                }
            }
            return Err("终端正在退出，请稍后重新连接".into());
        }
        if let Some(existing) = existing {
            if matches!(existing.status.as_str(), "running" | "stopping") {
                let updated = state.update(terminal_id, |t| {
                    // The reader may have published its final status since the
                    // snapshot above; never replace that result with recovery.
                    if matches!(t.status.as_str(), "running" | "stopping") {
                        t.status = if t.status == "stopping" {
                            "cancelled"
                        } else {
                            "interrupted"
                        }
                        .into();
                        t.preview = "终端已退出".into();
                    }
                })?;
                runtime::emit(&app, &updated);
            }
            sync_owner_status(&app, terminal_id);
            if let Some(latest) = state
                .db
                .lock()
                .unwrap()
                .tasks
                .iter()
                .find(|t| t.id == id)
                .cloned()
            {
                original = latest;
            }
        }
    }
    // A native CLI cannot attach its TUI to a pipe-based headless process.
    // Stop and join it before resuming the same session in a newly allocated PTY.
    if original.status == "stopping" {
        return Err("任务正在终止，请稍后连接终端".into());
    }
    if ["running", "waiting", "queued"].contains(&original.status.as_str()) {
        if !stop_current {
            return Err("请先停止当前执行，再在终端继续同一会话".into());
        }
        runtime::cancel_in_project(&app, &id)?;
        let until = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while state.children.lock().unwrap().contains_key(&id) {
            if std::time::Instant::now() >= until {
                return Err("原任务尚未退出，请稍后重试".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(30));
        }
        if let Some(latest) = state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.id == id)
            .cloned()
        {
            original = latest;
        }
    }
    let agent = state
        .db
        .lock()
        .unwrap()
        .agents
        .iter()
        .find(|a| a.id == original.agent_id && a.available)
        .cloned()
        .ok_or("Agent 未安装，请先扫描程序")?;
    if let Some(previous_terminal) = &original.terminal_id {
        if state.ptys.lock().unwrap().contains_key(previous_terminal) {
            return Err("终端正在退出，请稍后重新连接".into());
        }
        if let Some(updated) =
            crate::terminal_history::finish_owner(&state, &id, previous_terminal)?
        {
            runtime::emit(&app, &updated);
        }
    }
    let mut args = crate::launch::tui_arguments(&agent, &original)?;
    if agent.kind == "claude" && original.session_id.is_none() {
        let session_id = uuid::Uuid::new_v4().to_string();
        args.extend(["--session-id".into(), session_id.clone()]);
        original.session_id = Some(session_id);
    }
    let cursor = crate::terminal_history::prepare(&state, &original)?;
    let provider_env = crate::providers::environment(&state, &original)?;
    let env = crate::launch::environment(&state, &original)?;
    let executable = discovery::resolve(&agent.executable).ok_or("找不到 Agent 程序")?;
    let settings =
        crate::launch_settings::prepare(&agent.kind, &original.project, &mut args, None)?;
    let mut cmd = crate::process::agent_pty_command(executable)?;
    cmd.args(&args);
    cmd.cwd(&original.project);
    cmd.env("PATH", discovery::path_env());
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if agent.kind == "goose" {
        cmd.env(
            "GOOSE_MODE",
            crate::launch::permission("goose", &original.permission)?,
        );
    }
    for (key, value) in env {
        cmd.env(key, value);
    }
    for (key, value) in provider_env {
        cmd.env(key, value);
    }
    let mut task = original.clone();
    task.id = uuid::Uuid::new_v4().to_string();
    task.title = format!("{} · 终端", original.title);
    task.source = "terminal".into();
    task.status = "running".into();
    task.usage = Usage::default();
    task.session_usage = None;
    task.usage_by_agent.clear();
    task.sessions.clear();
    task.created_at = now();
    task.updated_at = now();
    task.exit_code = None;
    task.history_path = None;
    task.parent_id = Some(original.id.clone());
    task.terminal_id = None;
    task.queued_messages.clear();
    task.active_prompt = None;
    task.preview = "已连接 Agent TUI".into();
    task.archived = false;
    task.terminal_cursor = Some(cursor);
    let terminal = spawn_terminal(app.clone(), &state, task, cmd, settings)?;
    {
        let mut db = state.db.lock().unwrap();
        if !db.tasks.iter().any(|t| t.id == id) {
            db.tasks.push(original.clone());
        }
    }
    let owner = state.update(&id, |t| {
        t.terminal_id = Some(terminal.id.clone());
        t.session_id = original.session_id.clone();
        if t.source == "history" {
            t.source = "managed".into();
        }
    })?;
    runtime::emit(&app, &owner);
    // Re-read the PTY task: it may have exited while the owner link was saved.
    sync_owner_status(&app, &terminal.id);
    Ok(terminal)
}

/// The visible conversation follows its current PTY, independently of whether
/// this Agent exposes a history format. Older terminals cannot overwrite a new one.
pub(crate) fn sync_owner_status<R: tauri::Runtime>(app: &tauri::AppHandle<R>, terminal_id: &str) {
    let state = app.state::<AppState>();
    let mut db = state.db.lock().unwrap();
    let Some(terminal) = db
        .tasks
        .iter()
        .find(|t| t.id == terminal_id && t.source == "terminal")
        .cloned()
    else {
        return;
    };
    let Some(owner_id) = terminal.parent_id.as_deref() else {
        return;
    };
    let Some(owner) = db
        .tasks
        .iter_mut()
        .find(|t| t.id == owner_id && t.terminal_id.as_deref() == Some(terminal_id))
    else {
        return;
    };
    if owner.status == terminal.status && owner.exit_code == terminal.exit_code {
        return;
    }
    owner.status = terminal.status.clone();
    owner.exit_code = terminal.exit_code;
    owner.updated_at = now();
    owner.preview = match terminal.status.as_str() {
        "running" => "终端运行中",
        "stopping" => "正在终止…",
        "cancelled" => "终端已停止",
        "failed" => "终端异常退出",
        _ => "终端已退出",
    }
    .into();
    let owner = owner.clone();
    if let Err(error) = state.save(&db) {
        eprintln!("终端状态保存失败：{error}");
    }
    drop(db);
    runtime::emit(app, &owner);
}
