mod about;
mod discovery;
mod files;
mod followup;
mod history;
mod instructions;
mod integrations;
mod lan;
mod launch;
mod llm_settings;
mod models;
mod prompt_optimizer;
mod provider_http;
mod providers;
mod runtime;
mod store;
mod supervisor;
mod templates;
mod temporary_projects;
mod terminal;
mod terminal_history;
mod transcript;
use models::*;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use store::AppState;
use tauri::{Manager, State};

fn snapshot_inner(state: &AppState, scan: bool, cached: bool) -> Result<Snapshot, String> {
    if scan && !cached {
        let mut agents = discovery::discover(&[]);
        let mut db = state.db.lock().unwrap();
        // Keep custom agents added/removed while the background probe was running.
        agents.extend(
            db.agents
                .iter()
                .filter(|a| a.custom)
                .cloned()
                .map(|mut agent| {
                    agent.available = discovery::resolve(&agent.executable).is_some();
                    agent
                }),
        );
        db.agents = agents;
        state.save(&db)?;
    }
    let (history, warnings) = if cached {
        (state.history.lock().unwrap().cached(), vec![])
    } else {
        state.history.lock().unwrap().scan()
    };
    let db = state.db.lock().unwrap();
    let mut tasks = db.tasks.clone();
    for mut t in history {
        let mut matched = false;
        for managed in tasks.iter_mut().filter(|m| {
            t.subagent_id.is_none()
                && m.subagent_id.is_none()
                && m.source != "terminal"
                && t.session_id.is_some()
                && ((m.agent_kind == t.agent_kind && m.session_id == t.session_id)
                    || m.sessions.iter().any(|s| {
                        s.agent_kind == t.agent_kind && Some(&s.session_id) == t.session_id.as_ref()
                    }))
        }) {
            if managed.usage_by_agent.len() <= 1 && managed.agent_kind == t.agent_kind {
                managed.session_usage = Some(t.usage.clone());
            }
            matched = true;
        }
        if matched {
            continue;
        }
        t.archived =
            db.archived.contains(&t.id) || temporary_projects::unavailable(&db, &t.project);
        tasks.push(t);
    }
    let managed_parents: std::collections::HashMap<_, _> = db
        .tasks
        .iter()
        .filter(|t| t.subagent_id.is_none() && t.source != "terminal")
        .flat_map(|t| {
            t.session_id
                .iter()
                .map(|sid| (format!("history-{}-{sid}", t.agent_kind), t.id.clone()))
                .chain(t.sessions.iter().map(|s| {
                    (
                        format!("history-{}-{}", s.agent_kind, s.session_id),
                        t.id.clone(),
                    )
                }))
        })
        .collect();
    for t in &mut tasks {
        if let Some(parent) = t.parent_id.as_ref().and_then(|id| managed_parents.get(id)) {
            t.parent_id = Some(parent.clone());
        }
    }
    for t in &mut tasks {
        t.archived =
            db.archived.contains(&t.id) || temporary_projects::unavailable(&db, &t.project);
        if let Some(title) = db.titles.get(&t.id) {
            t.title = title.clone();
        }
    }
    tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    let mut projects = db.projects.clone();
    projects.extend(tasks.iter().map(|t| t.project.clone()));
    projects.sort();
    projects.dedup();
    projects.retain(|p| !temporary_projects::unavailable(&db, p));
    Ok(Snapshot {
        temporary_projects: db.temporary_projects.clone(),
        providers: db.providers.clone(),
        agents: db.agents.clone(),
        tasks,
        projects,
        warnings,
        data_dir: state.dir.to_string_lossy().into(),
    })
}
#[tauri::command]
async fn get_snapshot(
    app: tauri::AppHandle,
    scan: bool,
    cached: Option<bool>,
) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        snapshot_inner(&app.state::<AppState>(), scan, cached.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_detail(app: tauri::AppHandle, id: String) -> Result<TaskDetail, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if let Some(updated) = terminal_history::sync_owner(&state, &id)? {
            runtime::emit(&app, &updated);
        }
        let task = state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.id == id)
            .cloned();
        if let Some(task) = task {
            let mut messages: Vec<Message> =
                std::fs::File::open(state.dir.join("logs").join(format!("{id}.messages.jsonl")))
                    .map(|f| {
                        BufReader::new(f)
                            .lines()
                            .map_while(Result::ok)
                            .filter_map(|s| serde_json::from_str::<Message>(&s).ok())
                            .collect()
                    })
                    .unwrap_or_default();
            if task.terminal_id.is_none()
                && !["running", "queued"].contains(&task.status.as_str())
                && task.sessions.len() <= 1
                && task.usage_by_agent.len() <= 1
            {
                let native = task.session_id.as_ref().and_then(|id| {
                    state
                        .history
                        .lock()
                        .unwrap()
                        .find_session(&task.agent_kind, id)
                });
                if let Some(native) = native {
                    if let Some(path) = native.history_path {
                        if let Ok((_, full)) =
                            history::parse_file(std::path::Path::new(&path), &task.agent_kind, true)
                        {
                            if !full.is_empty()
                                && (full.len() >= messages.len()
                                    || (full.iter().any(|m| m.tool.is_some())
                                        && !messages.iter().any(|m| m.tool.is_some())))
                            {
                                messages = full;
                            }
                        }
                    }
                }
            }
            let log = if let Ok(mut f) = std::fs::File::open(state.log_path(&id)) {
                let len = f.metadata().map(|m| m.len()).unwrap_or(0);
                let _ = f.seek(SeekFrom::Start(len.saturating_sub(200000)));
                let mut bytes = vec![];
                let _ = f.read_to_end(&mut bytes);
                String::from_utf8_lossy(&bytes).into_owned()
            } else {
                String::new()
            };
            Ok(TaskDetail {
                task,
                messages,
                log,
            })
        } else {
            let (tasks, _) = state.history.lock().unwrap().scan();
            let task = tasks
                .into_iter()
                .find(|t| t.id == id)
                .ok_or("会话不存在，请刷新历史记录")?;
            let (mut task, messages) = history::parse_file(
                std::path::Path::new(task.history_path.as_deref().ok_or("缺少文件路径")?),
                &task.agent_kind,
                true,
            )?;
            if let Some(title) = state.db.lock().unwrap().titles.get(&id) {
                task.title = title.clone();
            }
            Ok(TaskDetail {
                task,
                messages,
                log: "历史会话按需读取，原始记录保持不变。".into(),
            })
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn create_task(
    app: tauri::AppHandle,
    state: State<AppState>,
    input: TaskInput,
) -> Result<Task, String> {
    let queued = input.queued;
    let task = runtime::create(&state, input, None)?;
    if !queued {
        runtime::start(app, task.id)
    } else {
        runtime::emit(&app, &task);
        Ok(task)
    }
}
#[tauri::command]
fn start_task<R: tauri::Runtime>(app: tauri::AppHandle<R>, id: String) -> Result<Task, String> {
    runtime::start(app, id)
}
#[tauri::command]
fn stop_task<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    state: State<AppState>,
    id: String,
) -> Result<Task, String> {
    let children: Vec<_> = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .filter(|t| {
            t.parent_id.as_deref() == Some(&id)
                && ["running", "waiting", "queued"].contains(&t.status.as_str())
        })
        .map(|t| t.id.clone())
        .collect();
    let parent = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .find(|t| t.id == id)
        .cloned()
        .ok_or("任务不存在")?;
    let task = if ["running", "waiting", "queued"].contains(&parent.status.as_str()) {
        runtime::cancel(&app, &id)?
    } else if !children.is_empty() {
        parent
    } else {
        return Err("任务已结束，无需停止".into());
    };
    terminal::stop(&state, &id);
    for child in children {
        terminal::stop(&state, &child);
        let _ = runtime::cancel(&app, &child);
    }
    Ok(task)
}
#[tauri::command]
fn save_agent(state: State<AppState>, mut agent: Agent) -> Result<Agent, String> {
    if agent.name.trim().is_empty() || agent.executable.trim().is_empty() {
        return Err("名称和程序路径不能为空".into());
    }
    if !agent.custom
        || (discovery::builtin(&agent.id)
            || ["terminal", "supervisor"].contains(&agent.id.as_str()))
    {
        return Err("不能覆盖内置 Agent".into());
    }
    if agent.id.is_empty() {
        agent.id = format!("custom-{}", uuid::Uuid::new_v4());
    }
    agent.kind = "custom".into();
    agent.available = discovery::resolve(&agent.executable).is_some();
    agent.version = "自定义程序".into();
    let mut db = state.db.lock().unwrap();
    if let Some(a) = db.agents.iter_mut().find(|a| a.id == agent.id) {
        *a = agent.clone();
    } else {
        db.agents.push(agent.clone());
    }
    state.save(&db)?;
    Ok(agent)
}
#[tauri::command]
fn remove_agent(state: State<AppState>, id: String) -> Result<(), String> {
    let mut db = state.db.lock().unwrap();
    if db
        .tasks
        .iter()
        .any(|t| t.agent_id == id && ["running", "waiting", "queued"].contains(&t.status.as_str()))
    {
        return Err("此 Agent 仍有未结束任务".into());
    }
    db.agents.retain(|a| a.id != id || !a.custom);
    state.save(&db)
}
#[tauri::command]
fn archive_task(state: State<AppState>, id: String, archived: bool) -> Result<(), String> {
    let mut db = state.db.lock().unwrap();
    if db
        .tasks
        .iter()
        .any(|t| t.id == id && ["running", "waiting", "queued"].contains(&t.status.as_str()))
    {
        return Err("请先停止或完成任务".into());
    }
    if !archived {
        if let Some(task) = db.tasks.iter().find(|t| t.id == id) {
            temporary_projects::check_available(&db, &task.project)?;
        }
    }
    db.archived.retain(|s| s != &id);
    if archived {
        db.archived.push(id);
    }
    temporary_projects::update_expiry(&mut db, chrono::Utc::now());
    state.save(&db)
}
#[tauri::command]
fn rename_task(state: State<AppState>, id: String, title: String) -> Result<(), String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 160 {
        return Err("名称须为 1–160 个字符".into());
    }
    let mut db = state.db.lock().unwrap();
    if let Some(task) = db.tasks.iter_mut().find(|t| t.id == id) {
        task.title = title.into();
    }
    db.titles.insert(id, title.into());
    state.save(&db)
}
#[tauri::command]
fn add_project(state: State<AppState>, project: String) -> Result<String, String> {
    let p = std::fs::canonicalize(project).map_err(|_| "目录不存在")?;
    if !p.is_dir() {
        return Err("请选择文件夹".into());
    }
    let p = p.to_string_lossy().into_owned();
    let mut db = state.db.lock().unwrap();
    if !db.projects.contains(&p) {
        db.projects.push(p.clone());
    }
    state.save(&db)?;
    Ok(p)
}
#[tauri::command]
fn parse_command(command: String) -> Result<(String, Vec<String>), String> {
    let mut words = shell_words::split(&command).map_err(|e| e.to_string())?;
    if words.is_empty() {
        return Err("请输入启动命令".into());
    }
    let executable = words.remove(0);
    Ok((executable, words))
}
#[tauri::command]
fn export_file(path: String, content: String) -> Result<(), String> {
    if content.len() > 20_000_000 {
        return Err("导出内容过大".into());
    }
    std::fs::write(path, content).map_err(|e| e.to_string())
}
#[tauri::command]
fn import_plugin(state: State<AppState>, manifest: String) -> Result<Agent, String> {
    let v: serde_json::Value = serde_json::from_str(&manifest).map_err(|e| e.to_string())?;
    if v["schemaVersion"] != 1 || v["type"] != "agent" {
        return Err("仅支持 schemaVersion=1 的 agent 插件")?;
    }
    let name = v["name"].as_str().ok_or("缺少 name")?;
    let executable = v["executable"].as_str().ok_or("缺少 executable")?;
    let args: Vec<String> =
        serde_json::from_value(v["args"].clone()).map_err(|_| "args 应为字符串数组")?;
    save_agent(
        state,
        Agent {
            id: String::new(),
            name: name.into(),
            kind: "custom".into(),
            executable: executable.into(),
            args,
            available: false,
            version: String::new(),
            custom: true,
        },
    )
}
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            let state = AppState::load(dir).map_err(std::io::Error::other)?;
            temporary_projects::startup(&state).map_err(std::io::Error::other)?;
            app.manage(std::sync::Arc::new(
                lan::LanState::load(state.dir.clone()).map_err(std::io::Error::other)?,
            ));
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            lan::lan_status,
            lan::lan_enable,
            lan::lan_disable,
            lan::lan_invite,
            lan::lan_approve,
            lan::lan_revoke,
            lan::lan_pair_begin,
            lan::lan_pair_finish,
            lan::lan_forget,
            lan::lan_rpc,
            lan::lan_remote_snapshots,
            instructions::instruction_files,
            instructions::read_instruction,
            instructions::save_instruction,
            integrations::integration_view,
            integrations::integration_save_mcp,
            integrations::integration_save_skill,
            integrations::integration_import_skill,
            integrations::integration_remove_skill,
            templates::list_task_templates,
            templates::save_task_template,
            templates::remove_task_template,
            prompt_optimizer::optimize_prompt,
            about::app_info,
            about::open_project_link,
            get_snapshot,
            temporary_projects::create_temporary_project,
            temporary_projects::keep_temporary_project,
            temporary_projects::cleanup_temporary_project,
            files::system_file_action,
            files::project_files,
            files::search_project_files,
            files::read_project_file,
            files::save_project_file,
            files::project_changes,
            files::project_file_diff,
            get_detail,
            create_task,
            providers::save_provider,
            providers::fetch_provider_models,
            providers::test_provider_connection,
            providers::remove_provider,
            followup::queue_message,
            followup::remove_queued_message,
            followup::run_queued_messages,
            terminal::connect_agent_terminal,
            start_task,
            stop_task,
            save_agent,
            remove_agent,
            archive_task,
            rename_task,
            add_project,
            parse_command,
            export_file,
            llm_settings::llm_status,
            llm_settings::clear_llm,
            import_plugin,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_read,
            llm_settings::configure_llm,
            supervisor::test_llm,
            supervisor::start_supervisor
        ])
        .build(tauri::generate_context!())
        .expect("无法启动 OiAgent")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                let mut ids: Vec<_> = state
                    .db
                    .lock()
                    .unwrap()
                    .tasks
                    .iter()
                    .filter(|t| t.status == "running")
                    .map(|t| t.id.clone())
                    .collect();
                ids.extend(state.children.lock().unwrap().keys().cloned());
                ids.extend(state.ptys.lock().unwrap().keys().cloned());
                ids.sort();
                ids.dedup();
                for id in ids {
                    let _ = runtime::cancel(app, &id);
                    terminal::stop(&state, &id);
                }
            }
        });
}

#[cfg(test)]
mod integration_tests;
