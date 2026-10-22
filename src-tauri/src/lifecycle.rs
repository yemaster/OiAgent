//! A single close path for window controls, application menus and the system tray.
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{Emitter, Manager};

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum CloseBehavior {
    #[default]
    Ask,
    Tray,
    Quit,
}
#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CloseIntent {
    Close,
    Quit,
}
#[derive(Default)]
pub struct Lifecycle {
    pub approved: AtomicBool,
    tray: AtomicBool,
    pending: Mutex<Option<CloseIntent>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseInfo {
    behavior: CloseBehavior,
    tray_available: bool,
    running: usize,
    pending: Option<CloseIntent>,
}
fn behavior(state: &AppState) -> CloseBehavior {
    std::fs::read(state.dir.join("window-preferences.json"))
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}
pub fn show(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
pub fn request(app: &tauri::AppHandle, intent: CloseIntent) {
    let state = app.state::<Lifecycle>();
    // An explicit Quit always wins over a repeated window-close event.
    let mut pending = state.pending.lock().unwrap();
    if !matches!(*pending, Some(CloseIntent::Quit)) {
        *pending = Some(intent);
    }
    drop(pending);
    show(app);
    let _ = app.emit_to("main", "app-close-requested", ());
}
pub fn install(app: &tauri::App) {
    app.manage(Lifecycle::default());
    match crate::tray::install(app) {
        Ok(available) => app
            .state::<Lifecycle>()
            .tray
            .store(available, Ordering::Release),
        Err(error) => eprintln!("System tray unavailable: {error}"),
    }
}
#[tauri::command]
pub fn close_info(app: tauri::AppHandle) -> CloseInfo {
    let state = app.state::<AppState>();
    let lifecycle = app.state::<Lifecycle>();
    let mut ids: HashSet<String> = state.children.lock().unwrap().keys().cloned().collect();
    ids.extend(state.ptys.lock().unwrap().keys().cloned());
    ids.extend(
        state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .filter(|t| {
                ["running", "waiting", "stopping"].contains(&t.status.as_str())
                    && ["managed", "terminal", "internal", "supervisor", "workflow"]
                        .contains(&t.source.as_str())
            })
            .map(|t| t.id.clone()),
    );
    let pending = *lifecycle.pending.lock().unwrap();
    CloseInfo {
        behavior: behavior(&state),
        tray_available: lifecycle.tray.load(Ordering::Acquire),
        running: ids.len(),
        pending,
    }
}
#[tauri::command]
pub fn set_close_behavior(app: tauri::AppHandle, behavior: CloseBehavior) -> Result<(), String> {
    if behavior == CloseBehavior::Tray && !app.state::<Lifecycle>().tray.load(Ordering::Acquire) {
        return Err("系统托盘不可用，请选择其他关闭方式".into());
    }
    let state = app.state::<AppState>();
    let _guard = state.config_lock.lock().unwrap();
    let bytes = serde_json::to_vec(&behavior).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(&state.dir).map_err(|e| e.to_string())?;
    use std::io::Write;
    temp.write_all(&bytes).map_err(|e| e.to_string())?;
    temp.persist(state.dir.join("window-preferences.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn apply_close(
    app: tauri::AppHandle,
    action: String,
    remember: bool,
    confirmed: Option<bool>,
) -> Result<(), String> {
    let lifecycle = app.state::<Lifecycle>();
    match action.as_str() {
        "cancel" => {
            lifecycle.pending.lock().unwrap().take();
        }
        "tray" => {
            if !lifecycle.tray.load(Ordering::Acquire) {
                return Err("系统托盘不可用，窗口已保留".into());
            }
            let window = app.get_webview_window("main").ok_or("窗口不存在")?;
            if remember {
                set_close_behavior(app.clone(), CloseBehavior::Tray)?;
            }
            window.hide().map_err(|e| e.to_string())?;
            lifecycle.pending.lock().unwrap().take();
        }
        "quit" => {
            if !confirmed.unwrap_or(false) && close_info(app.clone()).running > 0 {
                return Err("仍有任务运行，请确认退出".into());
            }
            if remember {
                set_close_behavior(app.clone(), CloseBehavior::Quit)?;
            }
            let handle = app.clone();
            tauri::async_runtime::spawn_blocking(move || shutdown(&handle))
                .await
                .map_err(|e| e.to_string())??;
            lifecycle.approved.store(true, Ordering::Release);
            app.exit(0);
        }
        _ => return Err("不支持的关闭操作".into()),
    }
    Ok(())
}

/// Keep the event loop alive until OS processes have exited. The exit-event fallback is idempotent.
/// Never take workflow_lock: an executor may hold it while waiting for project_lock.
pub fn shutdown<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _shutdown = state.shutdown_lock.lock().map_err(|e| e.to_string())?;
    if state.shutdown_complete.load(Ordering::Acquire) {
        return Ok(());
    }
    state.shutting_down.store(true, Ordering::Release);
    let result = (|| {
        let project_guard = state.project_lock.lock().map_err(|e| e.to_string())?;
        let children: Vec<_> = state
            .children
            .lock()
            .unwrap()
            .iter()
            .map(|(id, child)| (id.clone(), child.clone()))
            .collect();
        let terminals: Vec<_> = state
            .ptys
            .lock()
            .unwrap()
            .iter()
            .map(|(id, pty)| (id.clone(), pty.child.clone()))
            .collect();
        let mut roots = Vec::new();
        for (_, child) in &children {
            let mut child = child.lock().unwrap();
            crate::owned_processes::remember_descendants(&state, child.id(), false);
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                roots.push(child.id());
            }
        }
        for (_, child) in &terminals {
            let mut child = child.lock().unwrap();
            if let Some(pid) = child.process_id() {
                crate::owned_processes::remember_descendants(&state, pid, true);
            }
            if child.try_wait().map_err(|e| e.to_string())?.is_none() {
                if let Some(pid) = child.process_id() {
                    roots.push(pid);
                }
            }
        }
        // Capture descendants before stopping their parents; the inherited owner marker also
        // finds detached services after the original Agent/terminal has already exited.
        let mut owned =
            crate::owned_processes::OwnedProcesses::capture(&state.process_owner, &roots)?;
        owned.include_known(&state.owned_process_identities.lock().unwrap());
        let mut ids: HashSet<String> = children.iter().map(|(id, _)| id.clone()).collect();
        ids.extend(terminals.iter().map(|(id, _)| id.clone()));
        let updates = {
            let mut db = state.db.lock().unwrap();
            ids.extend(
                db.tasks
                    .iter()
                    .filter(|t| {
                        ["running", "waiting", "stopping"].contains(&t.status.as_str())
                            && ["managed", "terminal", "internal", "supervisor", "workflow"]
                                .contains(&t.source.as_str())
                    })
                    .map(|t| t.id.clone()),
            );
            let now = crate::models::now();
            for task in db.tasks.iter_mut().filter(|t| ids.contains(&t.id)) {
                task.status = "stopping".into();
                task.preview = "正在停止".into();
                task.updated_at = now.clone();
                if let Some(control) = &mut task.supervision {
                    control.generation = control.generation.saturating_add(1);
                    control.phase = "stopped".into();
                }
            }
            db.tasks
                .iter()
                .filter(|t| ids.contains(&t.id))
                .cloned()
                .collect::<Vec<_>>()
        };
        for task in &updates {
            crate::runtime::emit(app, task);
            crate::approvals::close(&state, &task.id);
        }
        owned.terminate_and_wait(std::time::Duration::from_secs(10))?;
        // Reap/confirm the process handles, independent of delayed UI events and log readers.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            let mut alive = false;
            for (_, child) in &children {
                alive |= child
                    .lock()
                    .unwrap()
                    .try_wait()
                    .map_err(|e| e.to_string())?
                    .is_none();
            }
            for (_, child) in &terminals {
                alive |= child
                    .lock()
                    .unwrap()
                    .try_wait()
                    .map_err(|e| e.to_string())?
                    .is_none();
            }
            if !alive {
                break;
            }
            if std::time::Instant::now() >= deadline {
                return Err("Agent 或终端仍在退出，请重试".into());
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
        {
            let mut db = state.db.lock().unwrap();
            let now = crate::models::now();
            for run in db
                .workflow_runs
                .iter_mut()
                .filter(|r| r.status == "running")
            {
                ids.insert(run.id.clone());
                run.status = "waiting".into();
                run.pause_requested = false;
                run.error = "应用已退出，可检查未完成节点后继续".into();
                run.updated_at = now.clone();
                run.revision += 1;
                for step in run.steps.iter_mut().filter(|s| s.status == "running") {
                    step.status = "failed".into();
                    step.finished_at = Some(now.clone());
                }
            }
            for task in db.tasks.iter_mut().filter(|t| ids.contains(&t.id)) {
                if task.source == "workflow" {
                    task.status = "waiting".into();
                    task.preview = "应用已退出，可检查未完成节点后继续".into();
                } else {
                    task.status = "cancelled".into();
                    task.preview = "应用退出，任务已停止".into();
                }
                task.updated_at = now.clone();
            }
            state.save(&db)?;
        }
        drop(project_guard);
        crate::temporary_projects::cleanup_ephemeral_projects(&state);
        state.shutdown_complete.store(true, Ordering::Release);
        Ok(())
    })();
    if result.is_err() {
        state.shutting_down.store(false, Ordering::Release);
    }
    result
}
