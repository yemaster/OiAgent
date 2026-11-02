//! Private, versioned SDK installs. Activating an update never modifies a running SDK.
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const PACKAGE: &str = "@qodercn-ai/qodercn-agent-sdk";
const MIN_VERSION: &str = "1.0.56";
const REGISTRY: &str = "https://registry.npmjs.org";
static ROOT: OnceLock<PathBuf> = OnceLock::new();
static UPDATE: Mutex<()> = Mutex::new(());

pub fn configure(app_dir: &Path) {
    let _ = ROOT.set(app_dir.join("qoder-sdk"));
}
fn root() -> Result<&'static Path, String> {
    ROOT.get()
        .map(PathBuf::as_path)
        .ok_or("Qoder SDK 存储尚未初始化".into())
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn enabled() -> bool {
    true
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    #[serde(default = "enabled")]
    auto_update: bool,
    version: Option<String>,
    directory: Option<String>,
    checked_at: Option<u64>,
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    version: Option<String>,
    auto_update: bool,
    checked_at: Option<u64>,
    error: Option<String>,
    runtime_ready: bool,
}
fn read(root: &Path) -> Settings {
    fs::read(root.join("sdk.json"))
        .ok()
        .and_then(|v| serde_json::from_slice(&v).ok())
        .unwrap_or(Settings {
            auto_update: true,
            ..Default::default()
        })
}
fn save(root: &Path, settings: &Settings) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    use std::io::Write;
    file.write_all(&serde_json::to_vec(settings).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    file.persist(root.join("sdk.json"))
        .map_err(|e| e.to_string())?;
    Ok(())
}
fn entry(root: &Path, settings: &Settings) -> Option<PathBuf> {
    let directory = settings.directory.as_deref()?;
    // Never let persisted metadata turn into an arbitrary module path.
    if !directory.starts_with("release-") || directory.contains(['/', '\\']) {
        return None;
    }
    let path = root
        .join(directory)
        .join("node_modules")
        .join(PACKAGE)
        .join("dist/index.js");
    path.is_file().then_some(path)
}
fn node() -> Result<PathBuf, String> {
    crate::discovery::resolve(if cfg!(windows) { "node.exe" } else { "node" })
        .ok_or("Qoder SDK 需要 Node.js 18 或更新版本，请安装后重试".into())
}
fn status(root: &Path, settings: Settings) -> Status {
    Status {
        version: entry(root, &settings).and(settings.version),
        auto_update: settings.auto_update,
        checked_at: settings.checked_at,
        error: settings.error,
        runtime_ready: node().is_ok(),
    }
}

// npm output stays off IPC: registry config or lifecycle diagnostics may contain secrets.
fn run(mut command: Command, timeout: Duration) -> Result<(), String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("无法启动 SDK 安装程序：{e}"))?;
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(exit)) => {
                return if exit.success() {
                    Ok(())
                } else {
                    Err("Qoder SDK 安装或校验失败，请检查 Node.js 版本、npm 和网络后重试".into())
                }
            }
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                crate::process::terminate_background(&mut child);
                let _ = child.wait();
                return Err("Qoder SDK 安装超时或进程异常，请重试".into());
            }
        }
    }
}
fn install(root: &Path, settings: &mut Settings) -> Result<(), String> {
    let node = node()?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|e| e.to_string())?;
    let metadata: serde_json::Value = client
        .get(format!("{REGISTRY}/{PACKAGE}/latest"))
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|_| "无法检查 Qoder SDK 更新，请检查网络后重试")?;
    let version = metadata["version"].as_str().ok_or("SDK 版本响应无效")?;
    let parsed = semver::Version::parse(version).map_err(|_| "SDK 版本响应无效")?;
    if parsed < semver::Version::parse(MIN_VERSION).unwrap() {
        return Err("镜像中的 Qoder SDK 版本过旧".into());
    }
    if entry(root, settings).is_some()
        && settings
            .version
            .as_deref()
            .is_some_and(|v| semver::Version::parse(v).is_ok_and(|v| v >= parsed))
    {
        return Ok(());
    }
    let npm = crate::discovery::resolve(if cfg!(windows) { "npm.cmd" } else { "npm" })
        .ok_or("找不到 npm，请安装 Node.js 后重试")?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let staging = tempfile::Builder::new()
        .prefix("install-")
        .tempdir_in(root)
        .map_err(|e| e.to_string())?;
    let mut command = crate::process::agent_command(npm)?;
    command
        .current_dir(staging.path())
        .env("PATH", crate::discovery::path_env())
        .env("QODER_SKIP_DOWNLOAD", "1")
        .args(["install", "--prefix"])
        .arg(staging.path())
        .args([
            "--ignore-scripts",
            "--no-audit",
            "--no-fund",
            "--save-exact",
            "--registry",
            REGISTRY,
        ])
        .arg(format!("{PACKAGE}@{version}"))
        .arg("zod@^4");
    run(command, Duration::from_secs(180))?;
    let installed = staging.path().join("node_modules").join(PACKAGE);
    let package: serde_json::Value = serde_json::from_slice(
        &fs::read(installed.join("package.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    if package["name"] != PACKAGE || package["version"] != version {
        return Err("SDK 安装版本校验失败".into());
    }
    let mut verify = crate::process::background_command(node);
    verify.args(["--input-type=module", "-e", "import {pathToFileURL} from 'node:url'; const s = await import(pathToFileURL(process.argv[1])); if (!s.startDaemon || !s.query) process.exit(1);"])
        .arg(installed.join("dist/index.js"));
    run(verify, Duration::from_secs(15))?;
    let directory = format!("release-{version}-{}", uuid::Uuid::new_v4());
    fs::rename(staging.path(), root.join(&directory)).map_err(|e| e.to_string())?;
    settings.version = Some(version.into());
    settings.directory = Some(directory);
    Ok(())
}
fn refresh(
    root: &Path,
    check: bool,
    update: bool,
    auto_update: Option<bool>,
) -> Result<Status, String> {
    refresh_with(root, check, update, auto_update, install)
}
fn refresh_with(
    root: &Path,
    check: bool,
    update: bool,
    auto_update: Option<bool>,
    install: impl FnOnce(&Path, &mut Settings) -> Result<(), String>,
) -> Result<Status, String> {
    let _lock = UPDATE.lock().map_err(|_| "SDK 更新锁不可用")?;
    let mut settings = read(root);
    if let Some(value) = auto_update {
        settings.auto_update = value;
    }
    let due = settings
        .checked_at
        .is_none_or(|t| now().saturating_sub(t) >= 24 * 60 * 60);
    if update || (check && settings.auto_update && due) {
        settings.error = install(root, &mut settings).err();
        settings.checked_at = Some(now());
    }
    save(root, &settings)?;
    Ok(status(root, settings))
}

#[tauri::command]
pub async fn qoder_sdk_status(
    app: tauri::AppHandle,
    check: bool,
    update: bool,
    auto_update: Option<bool>,
) -> Result<Status, String> {
    if !app
        .state::<crate::store::AppState>()
        .db
        .lock()
        .unwrap()
        .agents
        .iter()
        .any(|a| a.kind == "qodercn" && a.available && !a.custom)
    {
        return Err("尚未检测到 Qoder CLI CN".into());
    }
    let root = root()?.to_owned();
    tauri::async_runtime::spawn_blocking(move || refresh(&root, check, update, auto_update))
        .await
        .map_err(|e| e.to_string())?
}

pub fn command(cli: &Path) -> Result<Command, String> {
    let root = root()?;
    let settings = read(root);
    let sdk =
        entry(root, &settings).ok_or("Qoder SDK 尚未安装，请在 Agent 页面点击「安装 SDK」")?;
    let bridge = root.join(concat!("bridge-", env!("CARGO_PKG_VERSION"), ".mjs"));
    // Atomic writes also prevent concurrent probes from observing a partial script.
    let source = include_str!("../scripts/qoder-sdk-bridge.mjs");
    if fs::read_to_string(&bridge).ok().as_deref() != Some(source) {
        use std::io::Write;
        let mut file = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
        file.write_all(source.as_bytes())
            .map_err(|e| e.to_string())?;
        file.persist(&bridge).map_err(|e| e.to_string())?;
    }
    // Resolve Windows npm .cmd shims to their JS entry point for the SDK spawner.
    let invocation = crate::process::agent_command(cli)?;
    let cli_entry = invocation
        .get_args()
        .next()
        .unwrap_or(invocation.get_program());
    let mut command = crate::process::background_command(node()?);
    command.arg(bridge).arg(sdk).arg(cli_entry);
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sdk_settings_survive_reload_and_reject_external_modules() {
        let root = tempfile::tempdir().unwrap();
        assert!(read(root.path()).auto_update);
        let value = refresh(root.path(), false, false, Some(false)).unwrap();
        assert!(!value.auto_update);
        assert!(!read(root.path()).auto_update);
        assert!(entry(
            root.path(),
            &Settings {
                directory: Some("release-../../escape".into()),
                ..Default::default()
            }
        )
        .is_none());
    }

    #[test]
    fn automatic_checks_are_daily_and_failure_retains_the_active_install() {
        let root = tempfile::tempdir().unwrap();
        let entry = root
            .path()
            .join("release-old/node_modules")
            .join(PACKAGE)
            .join("dist/index.js");
        fs::create_dir_all(entry.parent().unwrap()).unwrap();
        fs::write(&entry, "fixture").unwrap();
        save(
            root.path(),
            &Settings {
                auto_update: true,
                version: Some("1.0.56".into()),
                directory: Some("release-old".into()),
                ..Default::default()
            },
        )
        .unwrap();
        let failed =
            refresh_with(root.path(), true, false, None, |_, _| Err("offline".into())).unwrap();
        assert_eq!(failed.version.as_deref(), Some("1.0.56"));
        assert_eq!(failed.error.as_deref(), Some("offline"));
        assert!(entry.is_file());
        refresh_with(root.path(), true, false, None, |_, _| {
            panic!("must respect daily check interval")
        })
        .unwrap();
        let retried = refresh_with(root.path(), false, true, None, |_, _| Ok(())).unwrap();
        assert!(retried.error.is_none());
        refresh_with(root.path(), false, false, Some(false), |_, _| {
            panic!("toggle does not install")
        })
        .unwrap();
        let mut settings = read(root.path());
        settings.checked_at = None;
        save(root.path(), &settings).unwrap();
        refresh_with(root.path(), true, false, None, |_, _| {
            panic!("opt-out must survive restarts")
        })
        .unwrap();
    }
}
