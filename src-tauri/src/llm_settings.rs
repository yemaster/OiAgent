use crate::{store::AppState, supervisor::LlmConfig};
use keyring::Entry;
use serde::Serialize;
use tauri::Manager;

#[derive(Default)]
pub struct LlmSettings {
    config: Option<LlmConfig>,
    loaded: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmStatus {
    configured: bool,
    base_url: String,
    model: String,
    has_key: bool,
}
fn entry() -> Result<Entry, String> {
    Entry::new("com.oiagent.desktop.llm", "default")
        .map_err(|_| "无法访问系统凭据库，请解锁后重试".into())
}
fn normalize(mut config: LlmConfig) -> Result<LlmConfig, String> {
    let url = reqwest::Url::parse(config.base_url.trim()).map_err(|_| "API 地址无效")?;
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API 地址不能包含用户名、密码、查询参数或片段".into());
    }
    if url.scheme() != "https"
        && !(url.scheme() == "http"
            && matches!(
                url.host_str(),
                Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
            ))
    {
        return Err("远程 API 请使用 HTTPS；本地 API 可使用 HTTP".into());
    }
    config.base_url = url.as_str().trim_end_matches('/').into();
    config.model = config.model.trim().into();
    if config.model.is_empty() {
        return Err("请输入模型名称".into());
    }
    Ok(config)
}
impl LlmSettings {
    fn load(&mut self, credential: &Entry) -> Result<(), String> {
        if self.loaded {
            return Ok(());
        }
        let config = match credential.get_password() {
            Ok(raw) => Some(normalize(
                serde_json::from_str(&raw).map_err(|_| "已保存的 LLM 配置无法读取，请重新保存")?,
            )?),
            Err(keyring::Error::NoEntry) => None,
            Err(_) => return Err("无法读取系统凭据库，请解锁或授权 OiAgent 后重试".into()),
        };
        self.config = config;
        self.loaded = true;
        Ok(())
    }
    fn save(&mut self, credential: &Entry, config: LlmConfig) -> Result<LlmStatus, String> {
        let mut config = normalize(config)?;
        if config.api_key.is_empty() {
            self.load(credential)?;
            if let Some(previous) = self
                .config
                .as_ref()
                .filter(|p| p.base_url == config.base_url)
            {
                config.api_key = previous.api_key.clone();
            }
        }
        // URL, model and key form one credential so a failed write cannot mix providers.
        let encoded = serde_json::to_string(&config).map_err(|_| "无法保存 LLM 配置")?;
        credential
            .set_password(&encoded)
            .map_err(|_| "无法加密保存 LLM 配置，请解锁系统凭据库后重试；原配置未更改")?;
        self.config = Some(config);
        self.loaded = true;
        Ok(self.status())
    }
    fn clear(&mut self, credential: &Entry) -> Result<(), String> {
        match credential.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => {}
            Err(_) => return Err("无法移除已保存配置，请解锁系统凭据库后重试".into()),
        }
        self.config = None;
        self.loaded = true;
        Ok(())
    }
    fn status(&self) -> LlmStatus {
        LlmStatus {
            configured: self.config.is_some(),
            base_url: self
                .config
                .as_ref()
                .map(|c| c.base_url.clone())
                .unwrap_or_default(),
            model: self
                .config
                .as_ref()
                .map(|c| c.model.clone())
                .unwrap_or_default(),
            has_key: self.config.as_ref().is_some_and(|c| !c.api_key.is_empty()),
        }
    }
    #[cfg(test)]
    pub fn session(config: LlmConfig) -> Self {
        Self {
            config: Some(config),
            loaded: true,
        }
    }
}
// Only called inside a blocking worker. Startup does not wait on credential-store access.
pub fn config(state: &AppState) -> Result<LlmConfig, String> {
    let mut stored = state.llm.lock().unwrap();
    if !stored.loaded {
        stored.load(&entry()?)?;
    }
    stored
        .config
        .clone()
        .ok_or("请先在设置中配置 LLM API".into())
}
#[tauri::command]
pub async fn llm_status(app: tauri::AppHandle) -> Result<LlmStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut stored = state.llm.lock().unwrap();
        if !stored.loaded {
            stored.load(&entry()?)?;
        }
        Ok(stored.status())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn configure_llm(app: tauri::AppHandle, config: LlmConfig) -> Result<LlmStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>()
            .llm
            .lock()
            .unwrap()
            .save(&entry()?, config)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn clear_llm(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AppState>().llm.lock().unwrap().clear(&entry()?)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn mock() -> Entry {
        Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()))
    }
    fn sample(key: &str) -> LlmConfig {
        LlmConfig {
            base_url: "https://provider.example/v1/".into(),
            model: "test-model".into(),
            api_key: key.into(),
        }
    }
    #[test]
    fn restores_after_restart_and_never_exposes_key_in_status() {
        let entry = mock();
        let mut original = LlmSettings::default();
        original.save(&entry, sample("test-secret")).unwrap();
        let mut restarted = LlmSettings::default();
        restarted.load(&entry).unwrap();
        assert_eq!(restarted.config.as_ref().unwrap().api_key, "test-secret");
        let status = serde_json::to_string(&restarted.status()).unwrap();
        assert!(status.contains("test-model"));
        assert!(!status.contains("test-secret"));
        restarted.save(&entry, sample("")).unwrap();
        assert_eq!(restarted.config.as_ref().unwrap().api_key, "test-secret");
        let mut other = sample("");
        other.base_url = "https://other.example/v1".into();
        restarted.save(&entry, other).unwrap();
        assert_eq!(restarted.config.as_ref().unwrap().api_key, "");
        restarted.clear(&entry).unwrap();
        let mut after_delete = LlmSettings::default();
        after_delete.load(&entry).unwrap();
        assert!(!after_delete.status().configured);
    }
    #[test]
    fn failed_write_keeps_memory_and_persistent_config_unchanged() {
        let entry = mock();
        let mut stored = LlmSettings::default();
        stored.save(&entry, sample("original-secret")).unwrap();
        entry
            .get_credential()
            .downcast_ref::<keyring::mock::MockCredential>()
            .unwrap()
            .set_error(keyring::Error::Invalid(
                "fixture".into(),
                "test-secret".into(),
            ));
        let error = stored
            .save(&entry, sample("replacement-secret"))
            .err()
            .unwrap();
        assert!(!error.contains("test-secret"));
        assert_eq!(stored.config.as_ref().unwrap().api_key, "original-secret");
        let mut restarted = LlmSettings::default();
        restarted.load(&entry).unwrap();
        assert_eq!(
            restarted.config.as_ref().unwrap().api_key,
            "original-secret"
        );
    }
    #[test]
    fn read_errors_are_retryable_and_local_services_can_have_no_key() {
        let entry = mock();
        let mut stored = LlmSettings::default();
        entry
            .get_credential()
            .downcast_ref::<keyring::mock::MockCredential>()
            .unwrap()
            .set_error(keyring::Error::Invalid("fixture".into(), "secret".into()));
        assert!(stored.load(&entry).is_err());
        assert!(!stored.loaded);
        stored.load(&entry).unwrap();
        assert!(!stored.status().configured);
        let mut config = sample("");
        config.base_url = "http://localhost:8080/v1".into();
        stored.save(&entry, config).unwrap();
        assert!(stored.status().configured);
        assert!(!stored.status().has_key);
        for url in [
            "http://remote.example/v1",
            "https://secret@provider.example/v1",
            "https://provider.example/v1?key=secret",
        ] {
            let mut config = sample("secret");
            config.base_url = url.into();
            assert!(stored.save(&entry, config).is_err());
        }
    }
}
