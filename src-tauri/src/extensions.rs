//! Application extensions are stored separately from agents and task snapshots.
use crate::store::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path},
};
use tauri::State;

const PACKAGE_LIMIT: u64 = 512 * 1024;
const DATA_LIMIT: usize = 128 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct View {
    pub id: String,
    pub title: String,
    #[serde(default = "default_icon")]
    pub icon: String,
    #[serde(default)]
    pub activity_bar: bool,
}
fn default_icon() -> String {
    "puzzle".into()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    pub id: String,
    pub title: String,
    pub view: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Setting {
    pub id: String,
    pub title: String,
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub default: Value,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Contributions {
    pub views: Vec<View>,
    #[serde(default)]
    pub commands: Vec<Command>,
    #[serde(default)]
    pub configuration: Vec<Setting>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    pub schema_version: u32,
    pub api_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub main: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub contributes: Contributions,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Extension {
    pub manifest: Manifest,
    pub enabled: bool,
    pub revision: String,
    #[serde(default)]
    pub settings: serde_json::Map<String, Value>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    #[serde(flatten)]
    pub extension: Extension,
    pub source: String,
    #[serde(default)]
    pub storage: serde_json::Map<String, Value>,
}
#[derive(Serialize)]
pub struct Catalog {
    items: Vec<Extension>,
    warnings: Vec<String>,
}
fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 100
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'.')
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && !value.contains("..")
}
fn short(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.len() <= max
}
fn unique<'a>(ids: impl Iterator<Item = &'a String>) -> bool {
    let mut seen = HashSet::new();
    ids.into_iter().all(|id| valid_id(id) && seen.insert(id))
}
fn validate(m: &Manifest) -> Result<(), String> {
    if m.schema_version != 2 || m.api_version != 1 {
        return Err("不支持的插件协议版本，需要 schemaVersion=2、apiVersion=1".into());
    }
    if !valid_id(&m.id)
        || !short(&m.name, 100)
        || !short(&m.version, 40)
        || m.description.len() > 1000
    {
        return Err("插件 ID、名称或版本无效".into());
    }
    let c = &m.contributes;
    if c.views.is_empty()
        || c.views.len() > 12
        || c.commands.len() > 32
        || c.configuration.len() > 32
        || !unique(c.views.iter().map(|v| &v.id))
        || !unique(c.commands.iter().map(|v| &v.id))
        || !unique(c.configuration.iter().map(|v| &v.id))
    {
        return Err("插件入口过多、ID 重复或格式无效".into());
    }
    let icons = [
        "puzzle", "notebook", "list", "chart", "code", "terminal", "folder", "workflow", "globe",
        "layout", "search", "check",
    ];
    for v in &c.views {
        if !short(&v.title, 100) || !icons.contains(&v.icon.as_str()) {
            return Err("页面标题或图标无效".into());
        }
    }
    if c.views.iter().filter(|v| v.activity_bar).count() > 1 {
        return Err("每个插件最多添加一个工具栏入口".into());
    }
    for cmd in &c.commands {
        if !short(&cmd.title, 100) || !c.views.iter().any(|v| v.id == cmd.view) {
            return Err("命令引用的页面不存在".into());
        }
    }
    for s in &c.configuration {
        if !short(&s.title, 100) || !setting_value(s, &s.default) {
            return Err("插件设置的类型或默认值无效".into());
        }
    }
    let allowed = ["workspace.read", "tasks.read", "tasks.draft"];
    let mut seen = HashSet::new();
    if m.permissions
        .iter()
        .any(|p| !allowed.contains(&p.as_str()) || !seen.insert(p))
    {
        return Err("插件请求了不支持或重复的权限".into());
    }
    Ok(())
}
fn setting_value(s: &Setting, value: &Value) -> bool {
    match s.kind.as_str() {
        "boolean" => value.is_boolean(),
        "string" => value.as_str().is_some_and(|v| v.len() <= 4000),
        _ => false,
    }
}
fn read_limited(path: &Path, limit: u64) -> Result<String, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len() > limit {
        return Err("插件文件不是普通文件或超出大小限制".into());
    }
    let mut text = String::new();
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(limit + 1)
        .read_to_string(&mut text)
        .map_err(|e| e.to_string())?;
    if text.len() as u64 > limit {
        return Err("插件文件过大".into());
    }
    Ok(text)
}
fn inspect(root: &Path) -> Result<Package, String> {
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let manifest_text = read_limited(&root.join("oiagent.plugin.json"), 64 * 1024)?;
    let manifest: Manifest =
        serde_json::from_str(&manifest_text).map_err(|e| format!("插件清单无效：{e}"))?;
    validate(&manifest)?;
    let main = Path::new(&manifest.main);
    if main.as_os_str().is_empty()
        || manifest.main.contains('\\')
        || main
            .components()
            .any(|p| !matches!(p, Component::Normal(_)))
        || main.extension().and_then(|s| s.to_str()) != Some("js")
    {
        return Err("main 必须是插件目录中的 .js 文件".into());
    }
    let mut path = root.clone();
    for part in main.components() {
        path.push(part);
        if fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("插件入口不能经过符号链接".into());
        }
    }
    if !path
        .canonicalize()
        .map_err(|e| e.to_string())?
        .starts_with(&root)
    {
        return Err("插件入口超出目录".into());
    }
    let source = read_limited(&path, PACKAGE_LIMIT)?;
    let revision = format!("{:x}", Sha256::digest(format!("{manifest_text}\0{source}")));
    Ok(Package {
        extension: Extension {
            manifest,
            enabled: false,
            revision,
            settings: Default::default(),
        },
        source,
        storage: Default::default(),
    })
}
fn load(state: &AppState, id: &str) -> Result<Package, String> {
    if !valid_id(id) {
        return Err("插件 ID 无效".into());
    }
    let p: Package = serde_json::from_str(&read_limited(
        &state.dir.join("extensions").join(format!("{id}.json")),
        2 * 1024 * 1024,
    )?)
    .map_err(|e| e.to_string())?;
    validate(&p.extension.manifest)?;
    if p.extension.manifest.id != id {
        return Err("插件 ID 不匹配".into());
    }
    Ok(p)
}
fn save(state: &AppState, p: &Package) -> Result<(), String> {
    let dir = state.dir.join("extensions");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut tmp = tempfile::NamedTempFile::new_in(&dir).map_err(|e| e.to_string())?;
    serde_json::to_writer(tmp.as_file_mut(), p).map_err(|e| e.to_string())?;
    tmp.persist(dir.join(format!("{}.json", p.extension.manifest.id)))
        .map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub async fn extension_catalog(state: State<'_, AppState>) -> Result<Catalog, String> {
    let _guard = state.config_lock.lock().map_err(|e| e.to_string())?;
    let dir = state.dir.join("extensions");
    let mut result = Catalog {
        items: vec![],
        warnings: vec![],
    };
    if !dir.exists() {
        return Ok(result);
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let id = entry
            .path()
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        match load(&state, &id) {
            Ok(p) => result.items.push(p.extension),
            Err(e) => result.warnings.push(format!("{id}：{e}")),
        }
    }
    result
        .items
        .sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    Ok(result)
}
#[tauri::command]
pub async fn inspect_extension(path: String) -> Result<Extension, String> {
    Ok(inspect(Path::new(&path))?.extension)
}
#[tauri::command]
pub async fn install_extension(
    state: State<'_, AppState>,
    path: String,
    revision: String,
) -> Result<Extension, String> {
    let mut p = inspect(Path::new(&path))?;
    if p.extension.revision != revision {
        return Err("插件文件已变化，请重新选择目录并确认权限".into());
    }
    let _guard = state.config_lock.lock().map_err(|e| e.to_string())?;
    if state
        .dir
        .join("extensions")
        .join(format!("{}.json", p.extension.manifest.id))
        .exists()
    {
        let old = load(&state, &p.extension.manifest.id)?;
        p.storage = old.storage;
        for s in &p.extension.manifest.contributes.configuration {
            if let Some(v) = old
                .extension
                .settings
                .get(&s.id)
                .filter(|v| setting_value(s, v))
            {
                p.extension.settings.insert(s.id.clone(), v.clone());
            }
        }
    }
    // Installing/updating never executes code; enabling is a separate explicit action.
    save(&state, &p)?;
    Ok(p.extension)
}
#[tauri::command]
pub async fn configure_extension(
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
    settings: serde_json::Map<String, Value>,
) -> Result<Extension, String> {
    let _guard = state.config_lock.lock().map_err(|e| e.to_string())?;
    let mut p = load(&state, &id)?;
    for (key, value) in &settings {
        if !p
            .extension
            .manifest
            .contributes
            .configuration
            .iter()
            .any(|s| &s.id == key && setting_value(s, value))
        {
            return Err("插件设置无效".into());
        }
    }
    p.extension.settings = settings;
    p.extension.enabled = enabled;
    save(&state, &p)?;
    Ok(p.extension)
}
#[tauri::command]
pub async fn remove_extension(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let _guard = state.config_lock.lock().map_err(|e| e.to_string())?;
    load(&state, &id)?;
    fs::remove_file(state.dir.join("extensions").join(format!("{id}.json")))
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn load_extension(state: State<'_, AppState>, id: String) -> Result<Package, String> {
    let _guard = state.config_lock.lock().map_err(|e| e.to_string())?;
    let p = load(&state, &id)?;
    if !p.extension.enabled {
        return Err("插件已停用".into());
    }
    Ok(p)
}
#[tauri::command]
pub async fn extension_storage(
    state: State<'_, AppState>,
    id: String,
    revision: String,
    storage: serde_json::Map<String, Value>,
) -> Result<(), String> {
    if serde_json::to_vec(&storage)
        .map_err(|e| e.to_string())?
        .len()
        > DATA_LIMIT
    {
        return Err("插件数据不能超过 128 KB".into());
    }
    let _guard = state.config_lock.lock().map_err(|e| e.to_string())?;
    let mut p = load(&state, &id)?;
    if !p.extension.enabled || p.extension.revision != revision {
        return Err("插件已停用或更新，请重新打开页面".into());
    }
    p.storage = storage;
    save(&state, &p)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn example() -> Manifest {
        serde_json::from_str(include_str!(
            "../../examples/plugins/project-notes/oiagent.plugin.json"
        ))
        .unwrap()
    }
    #[test]
    fn rejects_invalid_contributions_and_permissions() {
        let m = example();
        validate(&m).unwrap();
        let mut invalid = m.clone();
        invalid.id = "../state".into();
        assert!(validate(&invalid).is_err());
        let mut invalid = m.clone();
        invalid.permissions.push("shell.execute".into());
        assert!(validate(&invalid).is_err());
        let mut invalid = m.clone();
        invalid
            .contributes
            .views
            .push(m.contributes.views[0].clone());
        assert!(validate(&invalid).is_err());
        let mut invalid = m;
        invalid.contributes.commands[0].view = "missing".into();
        assert!(validate(&invalid).is_err());
    }
    #[test]
    fn inspects_snapshot_and_rejects_path_escape() {
        let dir = tempfile::tempdir().unwrap();
        let mut m = example();
        fs::write(dir.path().join("main.js"), "oiagent.onOpen(() => {});").unwrap();
        fs::write(
            dir.path().join("oiagent.plugin.json"),
            serde_json::to_vec(&m).unwrap(),
        )
        .unwrap();
        let first = inspect(dir.path()).unwrap();
        assert!(!first.extension.enabled);
        fs::write(dir.path().join("main.js"), "changed").unwrap();
        assert_ne!(
            first.extension.revision,
            inspect(dir.path()).unwrap().extension.revision
        );
        m.main = "../main.js".into();
        fs::write(
            dir.path().join("oiagent.plugin.json"),
            serde_json::to_vec(&m).unwrap(),
        )
        .unwrap();
        assert!(inspect(dir.path()).is_err());
    }
    #[test]
    fn persists_packages_separately() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let mut p = inspect(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../examples/plugins/project-notes")
                .as_path(),
        )
        .unwrap();
        p.storage
            .insert("note".into(), Value::String("draft".into()));
        save(&state, &p).unwrap();
        assert_eq!(
            load(&state, &p.extension.manifest.id).unwrap().storage["note"],
            "draft"
        );
        assert!(!state.dir.join("state.json").exists());
        assert!(load(&state, "../state").is_err());
    }
    #[test]
    fn install_update_permissions_and_disabled_storage() {
        use tauri::Manager;
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        app.manage(AppState::load(dir.path().into()).unwrap());
        tauri::async_runtime::block_on(async {
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../examples/plugins/project-notes")
                .to_string_lossy()
                .to_string();
            let preview = inspect_extension(path.clone()).await.unwrap();
            assert!(install_extension(app.state(), path.clone(), "stale".into())
                .await
                .is_err());
            let installed = install_extension(app.state(), path.clone(), preview.revision.clone())
                .await
                .unwrap();
            let id = installed.manifest.id;
            assert!(!installed.enabled);
            assert!(load_extension(app.state(), id.clone()).await.is_err());
            let settings = serde_json::json!({"task-prefix":"Review: "})
                .as_object()
                .unwrap()
                .clone();
            configure_extension(app.state(), id.clone(), true, settings.clone())
                .await
                .unwrap();
            let storage = serde_json::json!({"note":"preserved"})
                .as_object()
                .unwrap()
                .clone();
            extension_storage(
                app.state(),
                id.clone(),
                preview.revision.clone(),
                storage.clone(),
            )
            .await
            .unwrap();
            assert!(
                extension_storage(app.state(), id.clone(), "old".into(), storage.clone())
                    .await
                    .is_err()
            );
            let updated = install_extension(app.state(), path, preview.revision.clone())
                .await
                .unwrap();
            assert!(!updated.enabled);
            assert_eq!(updated.settings, settings);
            assert!(
                extension_storage(app.state(), id.clone(), preview.revision, storage)
                    .await
                    .is_err()
            );
            configure_extension(app.state(), id.clone(), true, settings)
                .await
                .unwrap();
            assert_eq!(
                load_extension(app.state(), id.clone())
                    .await
                    .unwrap()
                    .storage["note"],
                "preserved"
            );
            let invalid = serde_json::json!({"unknown":"value"})
                .as_object()
                .unwrap()
                .clone();
            assert!(configure_extension(app.state(), id.clone(), true, invalid)
                .await
                .is_err());
            fs::write(dir.path().join("extensions/broken.json"), "not-json").unwrap();
            let catalog = extension_catalog(app.state()).await.unwrap();
            assert_eq!(catalog.items.len(), 1);
            assert_eq!(catalog.warnings.len(), 1);
            remove_extension(app.state(), id.clone()).await.unwrap();
            assert!(load_extension(app.state(), id).await.is_err());
        });
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_entry() {
        let dir = tempfile::tempdir().unwrap();
        let m = example();
        fs::write(
            dir.path().join("oiagent.plugin.json"),
            serde_json::to_vec(&m).unwrap(),
        )
        .unwrap();
        fs::write(dir.path().join("real.js"), "").unwrap();
        std::os::unix::fs::symlink(dir.path().join("real.js"), dir.path().join("main.js")).unwrap();
        assert!(inspect(dir.path()).is_err());
    }
}
