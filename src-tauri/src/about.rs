use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({"version": app.package_info().version.to_string(), "os": std::env::consts::OS, "arch": std::env::consts::ARCH})
}
#[tauri::command]
pub fn open_project_link(app: tauri::AppHandle, page: String) -> Result<(), String> {
    let suffix = match page.as_str() {
        "source" => "",
        "releases" => "/releases",
        "issues" => "/issues/new",
        "guide" => "/blob/main/docs/USAGE.md",
        "credits" => "/blob/main/public/agents/README.md",
        _ => return Err("未知项目链接".into()),
    };
    app.opener()
        .open_url(
            format!("https://github.com/yemaster/OiAgent{suffix}"),
            None::<&str>,
        )
        .map_err(|e| e.to_string())
}
