use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    App, AppHandle, Emitter, Manager,
};

fn item(
    app: &App,
    id: &str,
    label: &str,
    shortcut: Option<&str>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
    MenuItem::with_id(app, id, label, true, shortcut)
}

pub fn install(app: &App) -> tauri::Result<()> {
    let menu = Menu::new(app)?;
    let separator = || PredefinedMenuItem::separator(app);
    #[cfg(target_os = "macos")]
    menu.append(&Submenu::with_id_and_items(
        app,
        "application",
        "OiAgent",
        true,
        &[
            &item(app, "settings-about", "关于 OiAgent", None)?,
            &separator()?,
            &item(app, "settings", "设置偏好…", Some("CmdOrCtrl+,"))?,
            &separator()?,
            &PredefinedMenuItem::services(app, Some("服务"))?,
            &separator()?,
            &PredefinedMenuItem::hide(app, Some("隐藏 OiAgent"))?,
            &PredefinedMenuItem::hide_others(app, Some("隐藏其他应用"))?,
            &PredefinedMenuItem::show_all(app, Some("显示全部"))?,
            &separator()?,
            &item(app, "quit", "退出 OiAgent", Some("CmdOrCtrl+Q"))?,
        ],
    )?)?;
    let file = Submenu::with_id_and_items(
        app,
        "file",
        "文件",
        true,
        &[
            &item(app, "new-task", "新建任务…", Some("CmdOrCtrl+N"))?,
            &item(app, "add-project", "添加项目…", Some("CmdOrCtrl+O"))?,
            &separator()?,
            &MenuItem::with_id(app, "save-file", "保存文件", false, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "close-tab", "关闭标签", false, Some("CmdOrCtrl+W"))?,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    {
        file.append(&separator()?)?;
        file.append(&item(app, "settings", "设置偏好…", Some("CmdOrCtrl+,"))?)?;
        file.append(&item(app, "quit", "退出 OiAgent", Some("CmdOrCtrl+Q"))?)?;
    }
    menu.append(&file)?;
    let edit = Submenu::new(app, "编辑", true)?;
    // Native undo/redo are supported by the macOS WebView; other platforms retain
    // their editor shortcuts rather than showing non-functional native entries.
    #[cfg(target_os = "macos")]
    {
        edit.append(&PredefinedMenuItem::undo(app, Some("撤销"))?)?;
        edit.append(&PredefinedMenuItem::redo(app, Some("重做"))?)?;
        edit.append(&separator()?)?;
    }
    edit.append_items(&[
        &PredefinedMenuItem::cut(app, Some("剪切"))?,
        &PredefinedMenuItem::copy(app, Some("复制"))?,
        &PredefinedMenuItem::paste(app, Some("粘贴"))?,
        &PredefinedMenuItem::select_all(app, Some("全选"))?,
    ])?;
    menu.append(&edit)?;
    menu.append(&Submenu::with_id_and_items(
        app,
        "view",
        "视图",
        true,
        &[
            &item(app, "tasks", "当前任务", None)?,
            &item(app, "todos", "TODO List", None)?,
            &item(app, "supervisor", "工作流", None)?,
            &item(app, "history", "历史记录", None)?,
            &item(app, "stats", "用量统计", None)?,
            &separator()?,
            &item(app, "agents", "Agent 程序", None)?,
            &item(app, "integrations", "MCP 与 Skills", None)?,
            &item(app, "plugins", "插件", None)?,
            &separator()?,
            &item(app, "search", "搜索任务…", Some("CmdOrCtrl+K"))?,
            &item(
                app,
                "toggle-sidebar",
                "显示 / 隐藏侧边栏",
                Some("CmdOrCtrl+B"),
            )?,
            &MenuItem::with_id(app, "back", "返回上一页", false, Some("Alt+Left"))?,
            &item(app, "refresh", "刷新 Agent 与历史记录", None)?,
        ],
    )?)?;
    let window = Submenu::with_id_and_items(
        app,
        "window",
        "窗口",
        true,
        &[
            &item(app, "minimize", "最小化", Some("CmdOrCtrl+M"))?,
            &item(app, "maximize", "缩放窗口", None)?,
            &item(app, "fullscreen", "进入 / 退出全屏", Some("F11"))?,
        ],
    )?;
    let help = Submenu::with_id_and_items(
        app,
        "help",
        "帮助",
        true,
        &[
            &item(app, "guide", "使用指南", None)?,
            &item(app, "open-docs", "在线文档", None)?,
            &item(app, "open-website", "OiAgent 官网", None)?,
            &separator()?,
            &item(app, "open-releases", "下载新版本", None)?,
            &item(app, "open-issues", "报告问题…", None)?,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    help.append(&item(app, "settings-about", "关于 OiAgent", None)?)?;
    menu.append_items(&[&window, &help])?;
    app.set_menu(menu)?;
    #[cfg(target_os = "macos")]
    {
        window.set_as_windows_menu_for_nsapp()?;
        help.set_as_help_menu_for_nsapp()?;
    }
    app.on_menu_event(|app, event| {
        if let Err(error) = dispatch(app, event.id().as_ref()) {
            let _ = app.emit_to("main", "menu-error", error);
        }
    });
    Ok(())
}

fn dispatch(app: &AppHandle, id: &str) -> Result<(), String> {
    let page = match id {
        "open-docs" => Some("guide"),
        "open-website" => Some("website"),
        "open-releases" => Some("releases"),
        "open-issues" => Some("issues"),
        _ => None,
    };
    if let Some(page) = page {
        return crate::about::open_project_link(app.clone(), page.into());
    }
    if let Some(window) = app.get_webview_window("main") {
        let result = match id {
            "quit" => Some(window.close()),
            "minimize" => Some(window.minimize()),
            "maximize" => Some(if window.is_maximized().map_err(|e| e.to_string())? {
                window.unmaximize()
            } else {
                window.maximize()
            }),
            "fullscreen" => {
                Some(window.set_fullscreen(!window.is_fullscreen().map_err(|e| e.to_string())?))
            }
            _ => None,
        };
        if let Some(result) = result {
            return result.map_err(|e| e.to_string());
        }
    }
    app.emit_to("main", "menu-action", id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_menu_state(
    app: AppHandle,
    can_save: bool,
    can_close: bool,
    can_back: bool,
    terminal_focused: bool,
) -> Result<(), String> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    for (parent, id, enabled) in [
        ("file", "save-file", can_save),
        ("file", "close-tab", can_close),
        ("view", "back", can_back),
    ] {
        if let Some(parent) = menu.get(parent).and_then(|m| m.as_submenu().cloned()) {
            if let Some(item) = parent.get(id).and_then(|m| m.as_menuitem().cloned()) {
                item.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
        }
    }
    // Keep TUI control keys available while the terminal owns keyboard focus.
    for (parent, id, shortcut) in [
        ("file", "new-task", "CmdOrCtrl+N"),
        ("file", "add-project", "CmdOrCtrl+O"),
        ("file", "save-file", "CmdOrCtrl+S"),
        ("file", "close-tab", "CmdOrCtrl+W"),
        ("view", "search", "CmdOrCtrl+K"),
        ("view", "toggle-sidebar", "CmdOrCtrl+B"),
        ("view", "back", "Alt+Left"),
        ("window", "minimize", "CmdOrCtrl+M"),
        ("window", "fullscreen", "F11"),
        (
            if cfg!(target_os = "macos") {
                "application"
            } else {
                "file"
            },
            "quit",
            "CmdOrCtrl+Q",
        ),
        (
            if cfg!(target_os = "macos") {
                "application"
            } else {
                "file"
            },
            "settings",
            "CmdOrCtrl+,",
        ),
    ] {
        if let Some(parent) = menu.get(parent).and_then(|m| m.as_submenu().cloned()) {
            if let Some(item) = parent.get(id).and_then(|m| m.as_menuitem().cloned()) {
                item.set_accelerator(if terminal_focused {
                    None
                } else {
                    Some(shortcut)
                })
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}
