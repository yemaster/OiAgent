use crate::{local_secret_store::Entry, models::*, store::AppState};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{Manager, State};

#[derive(Serialize, Deserialize)]
struct SavedKey {
    provider_id: String,
    base_url: String,
    auth_type: String,
    api_key: String,
}
fn local_entry(reference: &str) -> Result<Entry, String> {
    uuid::Uuid::parse_str(reference)
        .map(Entry::Provider)
        .map_err(|_| "本地密钥索引无效，请重新保存 API Key".into())
}
fn key(state: &AppState, profile: &ProviderProfile) -> Result<String, String> {
    let reference = profile
        .key_ref
        .as_deref()
        .ok_or("请在 Claude Code API 配置中转存旧密钥，或重新填写 API Key")?;
    let raw = local_entry(reference)?
        .load(&state.dir)?
        .ok_or("本地 API 密钥不存在，请重新保存 API Key")?;
    let saved: SavedKey =
        serde_json::from_slice(&raw).map_err(|_| "本地 API 密钥损坏，请重新保存")?;
    if saved.provider_id != profile.id
        || saved.base_url != profile.base_url
        || saved.auth_type != profile.auth_type
    {
        return Err("密钥与 API 配置不匹配，请重新保存 API Key".into());
    }
    Ok(saved.api_key)
}

#[tauri::command]
pub fn save_provider(
    state: State<AppState>,
    profile: ProviderProfile,
    api_key: String,
) -> Result<ProviderProfile, String> {
    save_profile(&state, profile, api_key)
}
fn save_profile(
    state: &AppState,
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
    if !profile.id.is_empty() && !db.providers.iter().any(|p| p.id == profile.id) {
        return Err("API 配置不存在".into());
    }
    if profile.id.is_empty() {
        profile.id = uuid::Uuid::new_v4().to_string();
    }
    persist_profile(state, &mut db, profile, api_key)
}
// Immutable encrypted entries are committed before their metadata reference.
// A failed database write restores the old profile and never rotates its key.
fn persist_profile(
    state: &AppState,
    db: &mut Database,
    mut profile: ProviderProfile,
    api_key: String,
) -> Result<ProviderProfile, String> {
    let old = db.providers.iter().find(|p| p.id == profile.id).cloned();
    profile.has_key = old.as_ref().is_some_and(|p| p.has_key);
    profile.key_ref = old.as_ref().and_then(|p| p.key_ref.clone());
    if api_key.is_empty()
        && old
            .as_ref()
            .is_some_and(|p| p.has_key && !crate::provider_http::same_service(p, &profile))
    {
        return Err("服务地址或鉴权方式已更改，请重新填写 API Key".into());
    }
    let new_entry = if api_key.is_empty() {
        None
    } else {
        let id = uuid::Uuid::new_v4();
        let entry = Entry::Provider(id);
        let encoded = serde_json::to_vec(&SavedKey {
            provider_id: profile.id.clone(),
            base_url: profile.base_url.clone(),
            auth_type: profile.auth_type.clone(),
            api_key,
        })
        .map_err(|_| "无法保存 API 密钥")?;
        entry.save(&state.dir, &encoded)?;
        profile.has_key = true;
        profile.key_ref = Some(id.to_string());
        Some(entry)
    };
    let previous = db.providers.clone();
    if let Some(index) = db.providers.iter().position(|p| p.id == profile.id) {
        db.providers[index] = profile.clone();
    } else {
        db.providers.push(profile.clone());
    }
    if let Err(error) = state.save(db) {
        db.providers = previous;
        if let Some(entry) = new_entry {
            let _ = entry.clear(&state.dir);
        }
        return Err(error);
    }
    if new_entry.is_some() {
        if let Some(reference) = old.and_then(|p| p.key_ref) {
            if let Ok(entry) = local_entry(&reference) {
                let _ = entry.clear(&state.dir);
            }
        }
    }
    Ok(profile)
}

/// This is the ONLY provider operation allowed to read the legacy keyring.
/// No implicit fallback on startup, launch, save, test, or local decryption failure.
#[tauri::command]
pub async fn migrate_provider_key(
    app: tauri::AppHandle,
    id: String,
) -> Result<ProviderProfile, String> {
    tauri::async_runtime::spawn_blocking(move || {
        migrate_with(&app.state::<AppState>(), &id, |id| {
            keyring::Entry::new("com.oiagent.desktop.providers", id)
                .and_then(|entry| entry.get_password())
                .map_err(|_| "无法读取旧密钥，可重新填写 API Key 后保存".into())
        })
    })
    .await
    .map_err(|_| "密钥转存失败，请重试".to_string())?
}
fn migrate_with(
    state: &AppState,
    id: &str,
    read: impl FnOnce(&str) -> Result<String, String>,
) -> Result<ProviderProfile, String> {
    let previous = state
        .db
        .lock()
        .unwrap()
        .providers
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or("API 配置不存在")?;
    if !previous.has_key || previous.key_ref.is_some() {
        return Ok(previous);
    }
    // Never hold the app database lock while the OS may ask for a password.
    let secret = read(id)?;
    if secret.is_empty() {
        return Err("旧密钥为空，请重新填写 API Key".into());
    }
    let mut db = state.db.lock().unwrap();
    let current = db
        .providers
        .iter()
        .find(|p| p.id == id)
        .cloned()
        .ok_or("API 配置已删除")?;
    if current.key_ref.is_some() {
        return Ok(current);
    }
    if !current.has_key || !crate::provider_http::same_service(&previous, &current) {
        return Err("API 配置已更改，请重新填写 API Key".into());
    }
    persist_profile(state, &mut db, current, secret)
}

#[tauri::command]
pub fn remove_provider(state: State<AppState>, id: String) -> Result<(), String> {
    remove_profile(&state, &id)
}
fn remove_profile(state: &AppState, id: &str) -> Result<(), String> {
    let mut db = state.db.lock().unwrap();
    if db.tasks.iter().any(|t| {
        (["running", "waiting", "queued", "stopping"].contains(&t.status.as_str())
            && t.provider_id.as_deref() == Some(id))
            || t.queued_messages
                .iter()
                .any(|m| m.provider_id.as_deref() == Some(id))
    }) {
        return Err("此配置正在被任务或待发送消息使用，请先停止任务或清空队列".into());
    }
    let index = db
        .providers
        .iter()
        .position(|p| p.id == id)
        .ok_or("API 配置不存在")?;
    let removed = db.providers.remove(index);
    if let Err(error) = state.save(&db) {
        db.providers.insert(index, removed);
        return Err(error);
    }
    if let Some(reference) = removed.key_ref {
        if let Ok(entry) = local_entry(&reference) {
            let _ = entry.clear(&state.dir);
        }
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
    let (profile, api_key) = {
        let db = state.db.lock().unwrap();
        let profile = db
            .providers
            .iter()
            .find(|p| &p.id == id)
            .cloned()
            .ok_or("API 配置已删除，请重新选择")?;
        let api_key = if profile.has_key {
            Some(key(state, &profile)?)
        } else {
            None
        };
        (profile, api_key)
    };
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
    if let Some(api_key) = api_key {
        env.insert(
            if profile.auth_type == "api-key" {
                "ANTHROPIC_API_KEY"
            } else {
                "ANTHROPIC_AUTH_TOKEN"
            }
            .into(),
            api_key,
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

/// Session settings have higher precedence than user/project settings.env.
/// Pass the selected provider through both channels: the initial process env
/// and the private --settings file. Managed policy remains owned by the CLI.
pub fn settings(task: &Task, env: &BTreeMap<String, String>) -> Option<serde_json::Value> {
    (task.agent_kind == "claude" && task.provider_id.is_some())
        .then(|| serde_json::json!({"env": env}))
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
    let db = state.db.lock().unwrap();
    let saved = db
        .providers
        .iter()
        .find(|p| p.id == profile.id)
        .ok_or("API 配置不存在")?;
    if !saved.has_key {
        return Ok(String::new());
    }
    if !crate::provider_http::same_service(&saved, profile) {
        return Err("服务地址或鉴权方式已更改，请重新填写 API Key".into());
    }
    key(state, saved)
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
        let state = AppState::load(dir.path().canonicalize().unwrap()).unwrap();
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
    #[test]
    fn selected_provider_overrides_session_env_without_mutating_other_settings() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().canonicalize().unwrap()).unwrap();
        let profile: ProviderProfile = serde_json::from_value(json!({
            "id":"selected", "name":"Selected", "baseUrl":"https://selected.example.test",
            "authType":"api-key", "defaultModel":"gateway-default", "haikuModel":"gateway-small",
            "sonnetModel":"gateway-medium", "opusModel":"gateway-large", "fableModel":"", "hasKey":false
        })).unwrap();
        state.db.lock().unwrap().providers.push(profile);
        let mut task: Task = serde_json::from_value(json!({
            "id":"t", "title":"test", "prompt":"test", "project":dir.path(), "agentId":"claude", "agentKind":"claude",
            "providerId":"selected", "status":"queued", "createdAt":"", "updatedAt":"", "preview":"", "usage":Usage::default(),
            "source":"managed", "model":"", "permission":"default"
        })).unwrap();
        // No real credential store, network service or user configuration is accessed.
        let mut env = environment(&state, &task).unwrap();
        env.insert(
            "ANTHROPIC_API_KEY".into(),
            "fixture-key-中文-\"-&-%PATH%".into(),
        );
        let original = json!({
            "env":{"ANTHROPIC_BASE_URL":"https://old.example.test", "ANTHROPIC_AUTH_TOKEN":"old-token",
                "ANTHROPIC_MODEL":"old-model", "CLAUDE_CODE_USE_BEDROCK":"1", "PROJECT_TOOL":"keep"},
            "permissions":{"deny":["Read(.env)"]}, "hooks":{"Stop":[]}
        });
        let original_path = dir.path().join("original settings.json");
        std::fs::write(&original_path, original.to_string()).unwrap();
        for mode in ["stream", "tui"] {
            let mut args: Vec<String> = if mode == "stream" {
                vec![
                    "--print".into(),
                    "--output-format".into(),
                    "stream-json".into(),
                ]
            } else {
                vec!["--resume".into(), "session".into()]
            };
            args.extend([
                "--settings".into(),
                original_path.to_string_lossy().into_owned(),
                "--".into(),
                task.prompt.clone(),
            ]);
            let guard = crate::launch_settings::prepare(
                "claude",
                &task.project,
                &mut args,
                settings(&task, &env),
            )
            .unwrap()
            .unwrap();
            let config: serde_json::Value =
                serde_json::from_slice(&std::fs::read(guard.path()).unwrap()).unwrap();
            for (key, value) in &env {
                assert_eq!(config["env"][key], *value, "{mode}: {key}");
            }
            assert_eq!(config["env"]["ANTHROPIC_AUTH_TOKEN"], "");
            assert_eq!(config["env"]["CLAUDE_CODE_USE_BEDROCK"], "0");
            assert_eq!(config["env"]["PROJECT_TOOL"], "keep");
            assert_eq!(config["permissions"], original["permissions"]);
            assert_eq!(config["hooks"], original["hooks"]);
            assert!(!args
                .iter()
                .any(|arg| arg.contains("fixture-key") || arg.contains("old-token")));
            let path = guard.path().to_owned();
            drop(guard);
            assert!(!path.exists());
        }
        assert_eq!(
            std::fs::read_to_string(&original_path).unwrap(),
            original.to_string()
        );
        task.provider_id = None;
        assert!(environment(&state, &task).unwrap().is_empty());
        assert!(settings(&task, &BTreeMap::new()).is_none());
        let mut args = vec!["--print".into()];
        assert!(crate::launch_settings::prepare(
            "claude",
            &task.project,
            &mut args,
            settings(&task, &BTreeMap::new())
        )
        .unwrap()
        .is_none());
        task.provider_id = Some("deleted".into());
        assert!(environment(&state, &task).unwrap_err().contains("已删除"));
    }
    fn fixture() -> ProviderProfile {
        serde_json::from_value(json!({"id":"", "name":"Test", "baseUrl":"https://api.example.test", "authType":"api-key", "defaultModel":"test", "haikuModel":"", "sonnetModel":"", "opusModel":"", "hasKey":false})).unwrap()
    }
    #[test]
    fn local_keys_survive_restart_rotate_and_remain_bound_to_the_service() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().canonicalize().unwrap()).unwrap();
        let first = save_profile(&state, fixture(), "fixture-secret-one".into()).unwrap();
        let second = save_profile(&state, fixture(), "fixture-secret-two".into()).unwrap();
        assert_ne!(first.key_ref, second.key_ref);
        let restarted = AppState::load(dir.path().canonicalize().unwrap()).unwrap();
        assert_eq!(key(&restarted, &first).unwrap(), "fixture-secret-one");
        assert_eq!(
            request_key(&restarted, &second, String::new()).unwrap(),
            "fixture-secret-two"
        );
        let kept = save_profile(&state, first.clone(), String::new()).unwrap();
        assert_eq!(kept.key_ref, first.key_ref);
        let mut changed = first.clone();
        changed.base_url = "https://other.example.test".into();
        assert!(save_profile(&state, changed.clone(), String::new()).is_err());
        assert!(request_key(&state, &changed, String::new()).is_err());
        let rotated = save_profile(&state, changed, "fixture-secret-three".into()).unwrap();
        assert_ne!(rotated.key_ref, first.key_ref);
        assert!(local_entry(first.key_ref.as_deref().unwrap())
            .unwrap()
            .load(&state.dir)
            .unwrap()
            .is_none());
        assert_eq!(key(&state, &rotated).unwrap(), "fixture-secret-three");
        let mut forged = second.clone();
        forged.key_ref = rotated.key_ref.clone();
        assert!(key(&state, &forged).unwrap_err().contains("不匹配"));
        for file in std::fs::read_dir(dir.path().join("secrets")).unwrap() {
            let raw = std::fs::read(file.unwrap().path()).unwrap();
            assert!(!raw
                .windows(b"fixture-secret".len())
                .any(|w| w == b"fixture-secret"));
        }
        let metadata = std::fs::read_to_string(dir.path().join("state.json")).unwrap();
        assert!(!metadata.contains("fixture-secret"));
        remove_profile(&state, &rotated.id).unwrap();
        assert!(local_entry(rotated.key_ref.as_deref().unwrap())
            .unwrap()
            .load(&state.dir)
            .unwrap()
            .is_none());
        assert_eq!(key(&state, &second).unwrap(), "fixture-secret-two");
    }
    #[test]
    fn failed_profile_commit_keeps_previous_key_and_rolls_back_memory() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().canonicalize().unwrap()).unwrap();
        let original = save_profile(&state, fixture(), "original-fixture".into()).unwrap();
        std::fs::create_dir(dir.path().join("state.json.tmp")).unwrap();
        let mut edited = original.clone();
        edited.name = "changed".into();
        assert!(save_profile(&state, edited, "replacement-fixture".into()).is_err());
        assert!(remove_profile(&state, &original.id).is_err());
        let stored = state.db.lock().unwrap().providers[0].clone();
        assert_eq!(stored.name, original.name);
        assert_eq!(stored.key_ref, original.key_ref);
        assert_eq!(key(&state, &stored).unwrap(), "original-fixture");
        assert_eq!(
            std::fs::read_dir(dir.path().join("secrets"))
                .unwrap()
                .count(),
            2
        );
        let restarted = AppState::load(dir.path().canonicalize().unwrap()).unwrap();
        assert_eq!(
            restarted.db.lock().unwrap().providers[0].key_ref,
            original.key_ref
        );
    }
    #[test]
    fn legacy_keys_require_explicit_migration_and_never_fallback_after_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().canonicalize().unwrap()).unwrap();
        let mut legacy = fixture();
        legacy.id = "legacy".into();
        legacy.has_key = true;
        state.db.lock().unwrap().providers.push(legacy.clone());
        assert!(request_key(&state, &legacy, String::new())
            .unwrap_err()
            .contains("转存"));
        let saved = migrate_with(&state, &legacy.id, |_| Ok("legacy-fixture".into())).unwrap();
        assert_eq!(key(&state, &saved).unwrap(), "legacy-fixture");
        let again = migrate_with(&state, &legacy.id, |_| {
            panic!("must not query the OS again")
        })
        .unwrap();
        assert_eq!(saved.key_ref, again.key_ref);
        std::fs::write(
            dir.path()
                .join("secrets")
                .join(format!("provider-{}.enc", saved.key_ref.unwrap())),
            b"corrupt",
        )
        .unwrap();
        assert!(request_key(&state, &again, String::new())
            .unwrap_err()
            .contains("损坏"));
        migrate_with(&state, &legacy.id, |_| {
            panic!("must not fallback to OS on corruption")
        })
        .unwrap();
        let repaired = save_profile(&state, again, "replacement-fixture".into()).unwrap();
        assert_eq!(key(&state, &repaired).unwrap(), "replacement-fixture");
    }
    #[test]
    fn migration_does_not_overwrite_a_key_saved_while_os_prompt_is_open() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().canonicalize().unwrap()).unwrap();
        let mut legacy = fixture();
        legacy.id = "legacy".into();
        legacy.has_key = true;
        state.db.lock().unwrap().providers.push(legacy.clone());
        let migrated = migrate_with(&state, &legacy.id, |_| {
            save_profile(&state, legacy.clone(), "newer-fixture".into()).unwrap();
            Ok("older-fixture".into())
        })
        .unwrap();
        assert_eq!(key(&state, &migrated).unwrap(), "newer-fixture");
        assert!(local_entry("../../outside").is_err());
    }
}
