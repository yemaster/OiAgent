use crate::local_llm_store;
use crate::{store::AppState, supervisor::LlmConfig};
use serde::Serialize;
use std::path::Path;
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
    fn load(&mut self, app_dir: &Path) -> Result<(), String> {
        if self.loaded {
            return Ok(());
        }
        let config = local_llm_store::load(app_dir)?
            .map(|raw| {
                normalize(
                    serde_json::from_slice(&raw)
                        .map_err(|_| "已保存的 LLM 配置无法读取，请重新保存")?,
                )
            })
            .transpose()?;
        self.config = config;
        self.loaded = true;
        Ok(())
    }
    fn save(&mut self, app_dir: &Path, config: LlmConfig) -> Result<LlmStatus, String> {
        let mut config = normalize(config)?;
        if config.api_key.is_empty() {
            self.load(app_dir)?;
            if let Some(previous) = self
                .config
                .as_ref()
                .filter(|p| p.base_url == config.base_url)
            {
                config.api_key = previous.api_key.clone();
            }
        }
        // Store URL, model and key together; a failed atomic write leaves the previous config intact.
        let encoded = serde_json::to_vec(&config).map_err(|_| "无法保存 LLM 配置")?;
        local_llm_store::save(app_dir, &encoded)?;
        self.config = Some(config);
        self.loaded = true;
        Ok(self.status())
    }
    fn clear(&mut self, app_dir: &Path) -> Result<(), String> {
        local_llm_store::clear(app_dir)?;
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
// Only called inside a blocking worker; settings are loaded lazily from app storage.
pub fn config(state: &AppState) -> Result<LlmConfig, String> {
    let mut stored = state.llm.lock().unwrap();
    if !stored.loaded {
        stored.load(&state.dir)?;
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
            stored.load(&state.dir)?;
        }
        Ok(stored.status())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn configure_llm(app: tauri::AppHandle, config: LlmConfig) -> Result<LlmStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = state.llm.lock().unwrap().save(&state.dir, config);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn clear_llm(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let result = state.llm.lock().unwrap().clear(&state.dir);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(key: &str) -> LlmConfig {
        LlmConfig {
            base_url: "https://provider.example/v1/".into(),
            model: "test-model".into(),
            api_key: key.into(),
        }
    }
    #[test]
    fn restores_after_restart_and_never_exposes_key_in_status() {
        let temp = tempfile::tempdir().unwrap();
        let entry = temp.path().canonicalize().unwrap();
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
        let temp = tempfile::tempdir().unwrap();
        let entry = temp.path().canonicalize().unwrap();
        let mut stored = LlmSettings::default();
        stored.save(&entry, sample("original-secret")).unwrap();
        // A non-directory application path forces a filesystem failure without changing saved data.
        let blocked = entry.join("blocked");
        std::fs::write(&blocked, b"fixture").unwrap();
        let error = stored
            .save(&blocked, sample("replacement-secret"))
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
        let temp = tempfile::tempdir().unwrap();
        let entry = temp.path().canonicalize().unwrap();
        let mut stored = LlmSettings::default();
        std::fs::create_dir_all(entry.join("secrets")).unwrap();
        std::fs::write(entry.join("secrets/llm.enc"), b"corrupt").unwrap();
        assert!(stored.load(&entry).is_err());
        assert!(!stored.loaded);
        local_llm_store::clear(&entry).unwrap();
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
