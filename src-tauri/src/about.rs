use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn app_info(app: tauri::AppHandle) -> serde_json::Value {
    serde_json::json!({"version": app.package_info().version.to_string(), "os": std::env::consts::OS, "arch": std::env::consts::ARCH})
}
#[tauri::command]
pub fn open_project_link(app: tauri::AppHandle, page: String) -> Result<(), String> {
    let url = project_url(&page)?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

pub(crate) fn project_url(page: &str) -> Result<&'static str, String> {
    match page {
        "website" => Ok("https://oiagent.yemaster.cn/"),
        "guide" => Ok("https://oiagent.yemaster.cn/docs/"),
        "source" => Ok("https://github.com/yemaster/OiAgent"),
        "releases" => Ok("https://github.com/yemaster/OiAgent/releases"),
        "issues" => Ok("https://github.com/yemaster/OiAgent/issues/new"),
        "credits" => Ok("https://github.com/yemaster/OiAgent/blob/main/public/agents/README.md"),
        _ => Err("未知项目链接".into()),
    }
}
