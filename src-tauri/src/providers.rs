use crate::{models::*, store::AppState};
use std::collections::BTreeMap;
use tauri::State;

#[cfg(target_os = "macos")]
fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.oiagent.desktop.providers", id).map_err(|e| e.to_string())
}
fn key(id: &str) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        entry(id)?
            .get_password()
            .map_err(|_| "无法读取 API 密钥，请在 API 配置中重新保存".into())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = id;
        Err("此平台尚未接入系统凭据存储，请使用任务环境变量".into())
    }
}
#[tauri::command]
pub fn save_provider(
    state: State<AppState>,
    mut profile: ProviderProfile,
    api_key: String,
) -> Result<ProviderProfile, String> {
    if profile.name.trim().is_empty() {
        return Err("请输入配置名称".into());
    }
    let url = reqwest::Url::parse(&profile.base_url).map_err(|_| "API 地址格式无效")?;
    if !["https", "http"].contains(&url.scheme())
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("请输入不含密钥的 HTTP(S) API 地址".into());
    }
    if !["api-key", "auth-token"].contains(&profile.auth_type.as_str()) {
        return Err("未知鉴权方式".into());
    }
    let mut db = state.db.lock().unwrap();
    let old = db.providers.iter().find(|p| p.id == profile.id).cloned();
    if !profile.id.is_empty() && old.is_none() {
        return Err("API 配置不存在".into());
    }
    if profile.id.is_empty() {
        profile.id = uuid::Uuid::new_v4().to_string();
    }
    profile.has_key = old.as_ref().is_some_and(|p| p.has_key);
    if !api_key.is_empty() {
        #[cfg(target_os = "macos")]
        {
            entry(&profile.id)?
                .set_password(&api_key)
                .map_err(|e| e.to_string())?;
            profile.has_key = true;
        }
        #[cfg(not(target_os = "macos"))]
        {
            return Err("此平台尚未接入系统凭据存储，请使用任务环境变量".into());
        }
    }
    db.providers.retain(|p| p.id != profile.id);
    db.providers.push(profile.clone());
    state.save(&db)?;
    Ok(profile)
}
#[tauri::command]
pub fn remove_provider(state: State<AppState>, id: String) -> Result<(), String> {
    let mut db = state.db.lock().unwrap();
    if db.tasks.iter().any(|t| {
        (["running", "waiting", "queued"].contains(&t.status.as_str())
            && t.provider_id.as_deref() == Some(&id))
            || t.queued_messages
                .iter()
                .any(|m| m.provider_id.as_deref() == Some(&id))
    }) {
        return Err("此配置正在被任务或待发送消息使用，请先停止任务或清空队列".into());
    }
    let old = db.providers.clone();
    db.providers.retain(|p| p.id != id);
    if old.len() == db.providers.len() {
        return Err("API 配置不存在".into());
    }
    state.save(&db)?;
    #[cfg(target_os = "macos")]
    if let Ok(entry) = entry(&id) {
        let _ = entry.delete_credential();
    }
    Ok(())
}
pub fn environment(state: &AppState, task: &Task) -> Result<BTreeMap<String, String>, String> {
    let Some(id) = task.provider_id.as_ref() else {
        return Ok(BTreeMap::new());
    };
    if task.agent_kind != "claude" {
        return Err("该 API 配置仅适用于 Claude Code".into());
    }
    let profile = state
        .db
        .lock()
        .unwrap()
        .providers
        .iter()
        .find(|p| &p.id == id)
        .cloned()
        .ok_or("API 配置已删除，请重新选择")?;
    let mut env = BTreeMap::new();
    env.insert("ANTHROPIC_BASE_URL".into(), profile.base_url);
    // Clear inherited conflicting auth variables without changing the global CLI configuration.
    env.insert("ANTHROPIC_API_KEY".into(), String::new());
    env.insert("ANTHROPIC_AUTH_TOKEN".into(), String::new());
    env.insert("CLAUDE_CODE_OAUTH_TOKEN".into(), String::new());
    for name in [
        "CLAUDE_CODE_USE_BEDROCK",
        "CLAUDE_CODE_USE_VERTEX",
        "CLAUDE_CODE_USE_FOUNDRY",
    ] {
        env.insert(name.into(), "0".into());
    }
    if profile.has_key {
        env.insert(
            if profile.auth_type == "api-key" {
                "ANTHROPIC_API_KEY"
            } else {
                "ANTHROPIC_AUTH_TOKEN"
            }
            .into(),
            key(id)?,
        );
    }
    for (name, value) in [
        ("ANTHROPIC_MODEL", profile.default_model),
        ("ANTHROPIC_DEFAULT_HAIKU_MODEL", profile.haiku_model),
        ("ANTHROPIC_DEFAULT_SONNET_MODEL", profile.sonnet_model),
        ("ANTHROPIC_DEFAULT_OPUS_MODEL", profile.opus_model),
    ] {
        env.insert(name.into(), value);
    }
    Ok(env)
}
