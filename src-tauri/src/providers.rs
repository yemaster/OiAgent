use crate::{models::*, store::AppState};
use std::collections::BTreeMap;
use tauri::State;

fn entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.oiagent.desktop.providers", id)
        .map_err(|_| "无法访问系统凭据库".into())
}
fn key(id: &str) -> Result<String, String> {
    entry(id)?
        .get_password()
        .map_err(|_| "无法读取 API 密钥，请解锁系统凭据库或重新保存密钥".into())
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
    profile.base_url = crate::provider_http::base_url(&profile.base_url)?
        .as_str()
        .trim_end_matches('/')
        .into();
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
    if api_key.is_empty()
        && old
            .as_ref()
            .is_some_and(|p| p.has_key && !crate::provider_http::same_service(p, &profile))
    {
        return Err("服务地址或鉴权方式已更改，请重新填写 API Key".into());
    }
    if !api_key.is_empty() {
        entry(&profile.id)?
            .set_password(&api_key)
            .map_err(|_| "无法保存密钥，请检查系统凭据库")?;
        profile.has_key = true;
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
        ("ANTHROPIC_DEFAULT_FABLE_MODEL", profile.fable_model),
    ] {
        env.insert(name.into(), value);
    }
    Ok(env)
}

fn request_key(
    state: &AppState,
    profile: &ProviderProfile,
    api_key: String,
) -> Result<String, String> {
    crate::provider_http::base_url(&profile.base_url)?;
    if !api_key.is_empty() {
        return Ok(api_key);
    }
    if profile.id.is_empty() {
        return Ok(String::new());
    }
    let saved = state
        .db
        .lock()
        .unwrap()
        .providers
        .iter()
        .find(|p| p.id == profile.id)
        .cloned()
        .ok_or("API 配置不存在")?;
    if !saved.has_key {
        return Ok(String::new());
    }
    if !crate::provider_http::same_service(&saved, profile) {
        return Err("服务地址或鉴权方式已更改，请重新填写 API Key".into());
    }
    key(&saved.id)
}
#[tauri::command]
pub async fn fetch_provider_models(
    state: State<'_, AppState>,
    profile: ProviderProfile,
    api_key: String,
) -> Result<crate::provider_http::ModelList, String> {
    let key = request_key(&state, &profile, api_key)?;
    crate::provider_http::models(profile, key).await
}
#[tauri::command]
pub async fn test_provider_connection(
    state: State<'_, AppState>,
    profile: ProviderProfile,
    api_key: String,
    model: String,
) -> Result<crate::provider_http::ConnectionTest, String> {
    let key = request_key(&state, &profile, api_key)?;
    crate::provider_http::test(profile, key, model).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn fable_mapping_is_passed_to_claude_and_old_keys_cannot_follow_a_changed_service() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let mut profile: ProviderProfile = serde_json::from_value(json!({"id":"test", "name":"Test", "baseUrl":"https://old.example.test", "authType":"api-key", "defaultModel":"fable", "haikuModel":"", "sonnetModel":"", "opusModel":"", "fableModel":"gateway-fable", "hasKey":false})).unwrap();
        state.db.lock().unwrap().providers.push(profile.clone());
        let task: Task = serde_json::from_value(json!({"id":"t", "title":"test", "prompt":"test", "project":"/test", "agentId":"claude", "agentKind":"claude", "providerId":"test", "status":"queued", "createdAt":"", "updatedAt":"", "preview":"", "usage":Usage::default(), "source":"managed", "model":"", "permission":"read-only"})).unwrap();
        assert_eq!(
            environment(&state, &task).unwrap()["ANTHROPIC_DEFAULT_FABLE_MODEL"],
            "gateway-fable"
        );
        state.db.lock().unwrap().providers[0].has_key = true;
        profile.base_url = "https://other.example.test".into();
        // Must fail before touching any real system credential.
        assert!(request_key(&state, &profile, String::new())
            .unwrap_err()
            .contains("重新填写"));
        assert_eq!(
            request_key(&state, &profile, "new-test-key".into()).unwrap(),
            "new-test-key"
        );
    }
}
