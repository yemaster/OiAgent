//! Native tray shortcuts share the application menu's navigation and close paths.
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter,
};

fn item(app: &tauri::App, action: &str, label: &str) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, format!("tray-{action}"), label, true, None::<&str>)
}

pub fn install(app: &tauri::App) -> tauri::Result<bool> {
    let Some(icon) = app.default_window_icon() else {
        return Ok(false);
    };
    let shortcuts = Submenu::with_items(
        app,
        "快捷入口",
        true,
        &[
            &item(app, "supervisor", "工作流")?,
            &item(app, "todos", "待办事项")?,
            &item(app, "stats", "用量统计")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "agents", "Agent 程序")?,
        ],
    )?;
    let help = Submenu::with_items(
        app,
        "帮助",
        true,
        &[
            &item(app, "guide", "使用指南")?,
            &item(app, "open-docs", "在线文档")?,
            &item(app, "open-releases", "下载更新")?,
            &item(app, "open-issues", "反馈问题")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "settings-about", "关于")?,
        ],
    )?;
    let menu = Menu::with_items(
        app,
        &[
            &item(app, "show", "显示窗口")?,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "new-task", "新建任务")?,
            &item(app, "tasks", "当前任务")?,
            &item(app, "history", "历史记录")?,
            &shortcuts,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "settings", "设置")?,
            &help,
            &PredefinedMenuItem::separator(app)?,
            &item(app, "quit", "退出")?,
        ],
    )?;
    TrayIconBuilder::with_id("oiagent")
        .icon(icon.clone())
        .tooltip("OiAgent")
        .menu(&menu)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_menu_event(|app, event| {
            let Some(action) = event.id.as_ref().strip_prefix("tray-") else {
                return;
            };
            match action {
                "show" => crate::lifecycle::show(app),
                "quit" => crate::lifecycle::request(app, crate::lifecycle::CloseIntent::Quit),
                "new-task" | "tasks" | "history" | "supervisor" | "todos" | "stats" | "agents"
                | "settings" | "settings-about" | "guide" | "open-docs" | "open-releases"
                | "open-issues" => {
                    // External help links do not need to bring the workspace forward.
                    if !action.starts_with("open-") {
                        crate::lifecycle::show(app);
                    }
                    if let Err(error) = crate::app_menu::dispatch(app, action) {
                        let _ = app.emit_to("main", "menu-error", error);
                    }
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            // On macOS a click opens the menu; do not also raise the window behind it.
            if !cfg!(target_os = "macos")
                && matches!(
                    event,
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    }
                )
            {
                crate::lifecycle::show(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(true)
}
