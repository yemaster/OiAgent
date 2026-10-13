use tauri_plugin_opener::OpenerExt;

fn conversation_url(value: &str) -> Result<reqwest::Url, String> {
    if value.chars().any(char::is_control) {
        return Err("无效网址".into());
    }
    let url = reqwest::Url::parse(value).map_err(|_| "无效网址")?;
    if !matches!(url.scheme(), "https" | "http")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("仅支持 HTTP / HTTPS 网页链接".into());
    }
    Ok(url)
}

#[tauri::command]
pub fn open_conversation_link(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url = conversation_url(&url)?;
    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conversation_links_only_open_web_urls() {
        assert!(conversation_url("https://example.com/docs?q=1#intro").is_ok());
        for value in [
            "javascript:alert(1)",
            "file:///etc/passwd",
            "vscode://file/tmp/a",
            "https://user:secret@example.com",
            "https://example.com\n",
        ] {
            assert!(conversation_url(value).is_err(), "{value}");
        }
    }
}

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
