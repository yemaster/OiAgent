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
            &item(app, "settings", "设置…", Some("CmdOrCtrl+,"))?,
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
            &item(app, "new-task", "新建任务", Some("CmdOrCtrl+N"))?,
            &item(app, "add-project", "打开项目…", Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "close-project", "关闭项目", false, None::<&str>)?,
            &separator()?,
            &MenuItem::with_id(app, "save-file", "保存文件", false, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(app, "close-tab", "关闭标签页", false, Some("CmdOrCtrl+W"))?,
        ],
    )?;
    #[cfg(not(target_os = "macos"))]
    {
        file.append(&separator()?)?;
        file.append(&item(app, "settings", "设置…", Some("CmdOrCtrl+,"))?)?;
        file.append(&item(app, "quit", "退出 OiAgent", Some("CmdOrCtrl+Q"))?)?;
    }
    menu.append(&file)?;
    let edit = Submenu::with_id(app, "edit", "编辑", true)?;
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
    edit.append_items(&[
        &separator()?,
        &item(app, "search", "搜索任务…", Some("CmdOrCtrl+K"))?,
        // Conversation/Monaco find shortcuts are owned by the focused view.
        &MenuItem::with_id(
            app,
            "find-conversation",
            "搜索当前对话…",
            false,
            None::<&str>,
        )?,
        &separator()?,
        &item(app, "settings-shortcuts", "快捷键…", None)?,
    ])?;
    menu.append(&edit)?;
    menu.append(&Submenu::with_id_and_items(
        app,
        "view",
        "视图",
        true,
        &[
            &item(app, "toggle-sidebar", "隐藏侧边栏", Some("CmdOrCtrl+B"))?,
            &item(app, "settings-appearance", "外观…", None)?,
            &separator()?,
            &item(app, "history", "历史记录", None)?,
            &item(app, "archived", "已归档", None)?,
            &item(app, "stats", "用量统计", None)?,
            &item(app, "plugins", "插件", None)?,
            &separator()?,
            &MenuItem::with_id(
                app,
                "back",
                "后退",
                false,
                Some(if cfg!(target_os = "macos") {
                    "Cmd+["
                } else {
                    "Alt+Left"
                }),
            )?,
        ],
    )?)?;
    menu.append(&Submenu::with_id_and_items(
        app,
        "task",
        "任务",
        true,
        &[
            &item(app, "tasks", "当前任务", None)?,
            &item(app, "supervisor", "工作流", None)?,
            &item(app, "todos", "TODO List", None)?,
            &separator()?,
            &MenuItem::with_id(app, "task-info", "任务详情", false, None::<&str>)?,
            &MenuItem::with_id(app, "task-artifacts", "产物", false, None::<&str>)?,
            &MenuItem::with_id(app, "task-processes", "进程与服务", false, None::<&str>)?,
        ],
    )?)?;
    menu.append(&Submenu::with_id_and_items(
        app,
        "agent",
        "Agent",
        true,
        &[
            &item(app, "agents", "Agent 程序…", None)?,
            &item(app, "claude-api", "Claude Code API…", None)?,
            &separator()?,
            &item(app, "integrations", "MCP 与 Skills…", None)?,
            &item(app, "instructions", "指令文件…", None)?,
            &separator()?,
            &item(app, "refresh", "刷新程序与历史记录", None)?,
        ],
    )?)?;
    menu.append(&Submenu::with_id_and_items(
        app,
        "terminal",
        "终端",
        true,
        &[
            &MenuItem::with_id(
                app,
                "open-project-terminal",
                "打开项目终端",
                false,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, "new-project-terminal", "新建终端", false, None::<&str>)?,
            &MenuItem::with_id(
                app,
                "split-project-terminal",
                "拆分终端",
                false,
                None::<&str>,
            )?,
            &separator()?,
            &MenuItem::with_id(
                app,
                "toggle-project-terminal",
                "显示项目终端",
                false,
                Some("Ctrl+Backquote"),
            )?,
        ],
    )?)?;
    let window = Submenu::with_id_and_items(
        app,
        "window",
        "窗口",
        true,
        &[
            &item(app, "minimize", "最小化", Some("CmdOrCtrl+M"))?,
            &item(
                app,
                "maximize",
                if cfg!(target_os = "macos") {
                    "缩放"
                } else {
                    "最大化 / 还原"
                },
                None,
            )?,
            &item(
                app,
                "fullscreen",
                "切换全屏",
                Some(if cfg!(target_os = "macos") {
                    "Ctrl+Cmd+F"
                } else {
                    "F11"
                }),
            )?,
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
    #[cfg(not(target_os = "macos"))]
    if let Some(window) = app.get_webview_window("main") {
        window.hide_menu()?;
    }
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

pub(crate) fn dispatch(app: &AppHandle, id: &str) -> Result<(), String> {
    if id == "quit" {
        crate::lifecycle::request(app, crate::lifecycle::CloseIntent::Quit);
        return Ok(());
    }
    if id.starts_with("tray-") {
        return Ok(());
    }
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

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuContext {
    #[serde(default)]
    can_close_project: bool,
    #[serde(default)]
    has_task: bool,
    #[serde(default)]
    has_artifacts: bool,
    #[serde(default)]
    has_processes: bool,
    #[serde(default)]
    has_project_terminal: bool,
    #[serde(default)]
    sidebar_visible: bool,
    #[serde(default)]
    terminal_visible: bool,
}

#[tauri::command]
pub fn set_menu_state(
    app: AppHandle,
    can_save: bool,
    can_close: bool,
    can_back: bool,
    terminal_focused: bool,
    shortcuts: Option<std::collections::HashMap<String, String>>,
    context: Option<MenuContext>,
) -> Result<(), String> {
    let Some(menu) = app.menu() else {
        return Ok(());
    };
    let context = context.unwrap_or_default();
    for (parent, id, enabled) in [
        ("file", "save-file", can_save),
        ("file", "close-tab", can_close),
        ("view", "back", can_back),
        ("file", "close-project", context.can_close_project),
        ("edit", "find-conversation", context.has_task),
        ("task", "task-info", context.has_task),
        ("task", "task-artifacts", context.has_artifacts),
        ("task", "task-processes", context.has_processes),
        (
            "terminal",
            "new-project-terminal",
            context.has_project_terminal,
        ),
        (
            "terminal",
            "split-project-terminal",
            context.has_project_terminal,
        ),
        (
            "terminal",
            "open-project-terminal",
            context.has_project_terminal,
        ),
        (
            "terminal",
            "toggle-project-terminal",
            context.has_project_terminal,
        ),
    ] {
        if let Some(parent) = menu.get(parent).and_then(|m| m.as_submenu().cloned()) {
            if let Some(item) = parent.get(id).and_then(|m| m.as_menuitem().cloned()) {
                item.set_enabled(enabled).map_err(|e| e.to_string())?;
            }
        }
    }
    for (parent, id, label) in [
        (
            "view",
            "toggle-sidebar",
            if context.sidebar_visible {
                "隐藏侧边栏"
            } else {
                "显示侧边栏"
            },
        ),
        (
            "terminal",
            "toggle-project-terminal",
            if context.terminal_visible {
                "隐藏项目终端"
            } else {
                "显示项目终端"
            },
        ),
    ] {
        if let Some(item) = menu
            .get(parent)
            .and_then(|m| m.as_submenu().and_then(|s| s.get(id)))
            .and_then(|m| m.as_menuitem().cloned())
        {
            item.set_text(label).map_err(|e| e.to_string())?;
        }
    }
    // Predefined Windows/Linux edit items register Ctrl+C/V/A accelerators too.
    // They must not swallow TUI control keys before the WebView receives them.
    if !cfg!(target_os = "macos") {
        if let Some(edit) = menu.get("edit").and_then(|m| m.as_submenu().cloned()) {
            let terminal_menu = edit.get("terminal-copy").is_some();
            if terminal_menu != terminal_focused {
                let count = if terminal_menu { 3 } else { 4 };
                for _ in 0..count {
                    edit.remove_at(0).map_err(|e| e.to_string())?;
                }
                if terminal_focused {
                    for (position, (id, label)) in [
                        ("terminal-copy", "复制"),
                        ("terminal-paste", "粘贴"),
                        ("terminal-select-all", "全选"),
                    ]
                    .into_iter()
                    .enumerate()
                    {
                        let entry = MenuItem::with_id(&app, id, label, true, None::<&str>)
                            .map_err(|e| e.to_string())?;
                        edit.insert(&entry, position).map_err(|e| e.to_string())?;
                    }
                } else {
                    for (position, entry) in [
                        PredefinedMenuItem::cut(&app, Some("剪切")),
                        PredefinedMenuItem::copy(&app, Some("复制")),
                        PredefinedMenuItem::paste(&app, Some("粘贴")),
                        PredefinedMenuItem::select_all(&app, Some("全选")),
                    ]
                    .into_iter()
                    .enumerate()
                    {
                        edit.insert(&entry.map_err(|e| e.to_string())?, position)
                            .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
    }
    // Keep TUI control keys available while the terminal owns keyboard focus.
    for (parent, id, shortcut) in [
        ("file", "new-task", "CmdOrCtrl+N"),
        ("file", "add-project", "CmdOrCtrl+O"),
        ("file", "save-file", "CmdOrCtrl+S"),
        ("file", "close-tab", "CmdOrCtrl+W"),
        ("edit", "search", "CmdOrCtrl+K"),
        ("view", "toggle-sidebar", "CmdOrCtrl+B"),
        ("terminal", "toggle-project-terminal", "Ctrl+Backquote"),
        (
            "view",
            "back",
            if cfg!(target_os = "macos") {
                "Cmd+["
            } else {
                "Alt+Left"
            },
        ),
        ("window", "minimize", "CmdOrCtrl+M"),
        (
            "window",
            "fullscreen",
            if cfg!(target_os = "macos") {
                "Ctrl+Cmd+F"
            } else {
                "F11"
            },
        ),
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
                let shortcut = shortcuts
                    .as_ref()
                    .and_then(|values| values.get(id))
                    .map(String::as_str)
                    .unwrap_or(shortcut);
                item.set_accelerator(
                    if (terminal_focused && id != "toggle-project-terminal") || shortcut.is_empty()
                    {
                        None
                    } else {
                        Some(shortcut)
                    },
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn show_application_menu(
    window: tauri::WebviewWindow,
    menu_id: String,
    x: f64,
    y: Option<f64>,
) -> Result<(), String> {
    let y = y.unwrap_or(32.0);
    if !matches!(
        menu_id.as_str(),
        "file" | "edit" | "view" | "task" | "agent" | "terminal" | "window" | "help"
    ) || !x.is_finite()
        || !y.is_finite()
        || x < 0.0
        || y < 0.0
    {
        return Err("未知应用菜单".into());
    }
    let menu = window.app_handle().menu().ok_or("应用菜单不可用")?;
    let submenu = menu
        .get(&menu_id)
        .and_then(|item| item.as_submenu().cloned())
        .ok_or("应用菜单不可用")?;
    window
        .popup_menu_at(&submenu, tauri::LogicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}
