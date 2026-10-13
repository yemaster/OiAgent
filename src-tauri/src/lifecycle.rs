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
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};

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
    let result = (|| -> tauri::Result<()> {
        let Some(icon) = app.default_window_icon() else {
            return Ok(());
        };
        let show_item = MenuItem::with_id(app, "tray-show", "打开 OiAgent", true, None::<&str>)?;
        let quit_item = MenuItem::with_id(app, "tray-quit", "退出 OiAgent…", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
        TrayIconBuilder::with_id("oiagent")
            .icon(icon.clone())
            .tooltip("OiAgent")
            .menu(&menu)
            .show_menu_on_left_click(cfg!(target_os = "macos"))
            .on_menu_event(|app, event| match event.id.as_ref() {
                "tray-show" => show(app),
                "tray-quit" => request(app, CloseIntent::Quit),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                ) {
                    show(tray.app_handle());
                }
            })
            .build(app)?;
        app.state::<Lifecycle>().tray.store(true, Ordering::Release);
        Ok(())
    })();
    if let Err(error) = result {
        eprintln!("System tray unavailable: {error}");
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
            .filter(|t| t.status == "running")
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
pub fn apply_close(
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
            lifecycle.approved.store(true, Ordering::Release);
            app.exit(0);
        }
        _ => return Err("不支持的关闭操作".into()),
    }
    Ok(())
}

/// Block new launches before collecting processes, then persist stopped runs.
/// Do not acquire workflow_lock here: an executor may hold it while waiting for project_lock.
pub fn shutdown<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<AppState>();
    state.shutting_down.store(true, Ordering::Release);
    let _project_guard = state.project_lock.lock().unwrap();
    let mut ids: HashSet<String> = state.children.lock().unwrap().keys().cloned().collect();
    ids.extend(state.ptys.lock().unwrap().keys().cloned());
    {
        let mut db = state.db.lock().unwrap();
        ids.extend(
            db.tasks
                .iter()
                .filter(|t| t.status == "running")
                .map(|t| t.id.clone()),
        );
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
        // Mark every owner before killing children, so supervisors cannot dispatch more work.
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
        if let Err(error) = state.save(&db) {
            eprintln!("Unable to save shutdown state: {error}");
        }
    }
    for id in ids {
        crate::approvals::close(&state, &id);
        if let Some(child) = state.children.lock().unwrap().get(&id) {
            crate::process::terminate_background(&mut child.lock().unwrap());
        }
        crate::terminal::stop(&state, &id);
    }
}
