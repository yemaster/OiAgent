use crate::{
    files::FileContent,
    integrations::{atomic_write, secure_path, Scope},
    store::AppState,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstructionEntry {
    id: String,
    path: String,
    exists: bool,
    description: String,
}
#[derive(Default)]
struct Roots {
    codex: Option<PathBuf>,
    claude: Option<PathBuf>,
    config: Option<PathBuf>,
}
impl Roots {
    fn environment() -> Self {
        Self {
            codex: std::env::var_os("CODEX_HOME").map(PathBuf::from),
            claude: std::env::var_os("CLAUDE_CONFIG_DIR").map(PathBuf::from),
            config: std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from),
        }
    }
}
fn definitions(
    home: &Path,
    scope: &Scope,
    roots: &Roots,
) -> Result<(PathBuf, Vec<(&'static str, &'static str)>), String> {
    let project = scope
        .project
        .as_ref()
        .map(|p| fs::canonicalize(p).map_err(|_| "项目目录不存在"))
        .transpose()?;
    if project.as_ref().is_some_and(|p| !p.is_dir()) {
        return Err("请选择项目目录".into());
    }
    let user = project.is_none();
    let base = project.unwrap_or_else(|| match scope.kind.as_str() {
        "codex" => roots.codex.clone().unwrap_or_else(|| home.join(".codex")),
        "claude" => roots.claude.clone().unwrap_or_else(|| home.join(".claude")),
        "qwen" => home.join(".qwen"),
        "gemini" => home.join(".gemini"),
        "opencode" => roots
            .config
            .clone()
            .unwrap_or_else(|| home.join(".config"))
            .join("opencode"),
        _ => home.into(),
    });
    if !base.is_absolute() {
        return Err("Agent 配置目录必须为绝对路径".into());
    }
    secure_path(&base)?;
    let files = match scope.kind.as_str() {
        "codex" => vec![
            ("AGENTS.md", "常用指令"),
            (
                "AGENTS.override.md",
                "覆盖同目录的 AGENTS.md；由 Codex 按原生规则加载",
            ),
        ],
        "claude" if user => vec![("CLAUDE.md", "用户指令")],
        "claude" => vec![
            ("CLAUDE.md", "项目指令"),
            (".claude/CLAUDE.md", "项目指令的另一存放位置"),
            (
                "CLAUDE.local.md",
                "仅供本机使用的项目指令，请确认 Git 忽略规则",
            ),
        ],
        "qwen" if user => vec![("QWEN.md", "用户指令")],
        "qwen" => vec![
            ("QWEN.md", "项目指令"),
            (
                ".qwen/QWEN.local.md",
                "本机项目指令，请自行加入 Git 忽略规则",
            ),
        ],
        "gemini" => vec![(
            "GEMINI.md",
            "默认上下文文件；自定义文件名请在原生设置中管理",
        )],
        "opencode" => vec![("AGENTS.md", "常用指令")],
        _ => return Err("此 Agent 暂未适配指令文件，请从项目文件中编辑".into()),
    };
    Ok((base, files))
}
fn resolve(home: &Path, scope: &Scope, id: &str, roots: &Roots) -> Result<PathBuf, String> {
    let (base, files) = definitions(home, scope, roots)?;
    if !files.iter().any(|(name, _)| *name == id) {
        return Err("不支持的指令文件".into());
    }
    let path = base.join(id);
    secure_path(&path)?;
    Ok(path)
}
fn read(path: &Path) -> Result<FileContent, String> {
    secure_path(path)?;
    if !path.try_exists().map_err(|e| e.to_string())? {
        return Ok(FileContent {
            content: String::new(),
            revision: "missing".into(),
        });
    }
    let mut bytes = vec![];
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(256 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 256 * 1024 || bytes.contains(&0) {
        return Err("指令文件须为不超过 256 KB 的 UTF-8 文本".into());
    }
    let revision = format!("{:x}", Sha256::digest(&bytes));
    Ok(FileContent {
        content: String::from_utf8(bytes).map_err(|_| "指令文件不是 UTF-8")?,
        revision,
    })
}
fn write(path: &Path, content: &str, expected: &str) -> Result<FileContent, String> {
    if content.len() > 256 * 1024 || content.contains('\0') {
        return Err("指令内容须为不超过 256 KB 的文本".into());
    }
    let previous = read(path)?;
    if previous.revision != expected {
        return Err("文件已被其他程序修改，请比较差异后再保存".into());
    }
    if expected != "missing" {
        let backup = path
            .parent()
            .ok_or("无效路径")?
            .join(".oiagent-instruction-backups")
            .join(format!(
                "{}-{}.bak",
                path.file_name().unwrap().to_string_lossy(),
                uuid::Uuid::new_v4()
            ));
        atomic_write(&backup, previous.content.as_bytes())?;
    }
    // Detect edits made while writing the backup as well.
    if read(path)?.revision != expected {
        return Err("文件已被其他程序修改，请重新加载".into());
    }
    atomic_write(path, content.as_bytes())?;
    read(path)
}
fn home() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "无法获取用户目录".into())
}
#[tauri::command]
pub fn instruction_files(scope: Scope) -> Result<Vec<InstructionEntry>, String> {
    let (base, files) = definitions(&home()?, &scope, &Roots::environment())?;
    files
        .into_iter()
        .map(|(id, description)| {
            let path = base.join(id);
            secure_path(&path)?;
            Ok(InstructionEntry {
                id: id.into(),
                path: path.to_string_lossy().into(),
                exists: path.try_exists().map_err(|e| e.to_string())?,
                description: description.into(),
            })
        })
        .collect()
}
#[tauri::command]
pub fn read_instruction(scope: Scope, id: String) -> Result<FileContent, String> {
    read(&resolve(&home()?, &scope, &id, &Roots::environment())?)
}
#[tauri::command]
pub fn save_instruction(
    state: State<AppState>,
    scope: Scope,
    id: String,
    content: String,
    expected: String,
) -> Result<FileContent, String> {
    let _projects = state.project_lock.lock().map_err(|e| e.to_string())?;
    let _config = state.config_lock.lock().map_err(|e| e.to_string())?;
    let path = resolve(&home()?, &scope, &id, &Roots::environment())?;
    crate::temporary_projects::check_available(&state.db.lock().unwrap(), &path.to_string_lossy())?;
    write(&path, &content, &expected)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_native_files_without_creating_them_and_honors_roots() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().canonicalize().unwrap();
        let roots = Roots {
            codex: Some(home.join("codex-custom")),
            ..Default::default()
        };
        for (kind, user_path, project_path) in [
            ("codex", "codex-custom/AGENTS.md", "AGENTS.md"),
            ("claude", ".claude/CLAUDE.md", "CLAUDE.md"),
            ("qwen", ".qwen/QWEN.md", "QWEN.md"),
            ("gemini", ".gemini/GEMINI.md", "GEMINI.md"),
            ("opencode", ".config/opencode/AGENTS.md", "AGENTS.md"),
        ] {
            let user = Scope {
                kind: kind.into(),
                project: None,
            };
            let path = resolve(&home, &user, project_path, &roots).unwrap();
            assert_eq!(path, home.join(user_path));
            assert_eq!(read(&path).unwrap().revision, "missing");
            assert!(!path.exists());
            let project = Scope {
                kind: kind.into(),
                project: Some(home.to_string_lossy().into()),
            };
            assert_eq!(
                resolve(&home, &project, project_path, &roots).unwrap(),
                home.join(project_path)
            );
            assert!(resolve(&home, &project, "../secrets", &roots).is_err());
        }
    }
    #[test]
    fn saves_with_backup_and_rejects_stale_or_externally_created_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().canonicalize().unwrap().join("AGENTS.md");
        let a = write(&path, "# Rules\n", "missing").unwrap();
        assert!(write(&path, "overwrite", "missing").is_err());
        let b = write(&path, "# Updated\n", &a.revision).unwrap();
        assert_ne!(a.revision, b.revision);
        assert!(write(&path, "stale", &a.revision).is_err());
        let backup = fs::read_dir(path.parent().unwrap().join(".oiagent-instruction-backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(fs::read_to_string(backup).unwrap(), "# Rules\n");
        assert_eq!(fs::read_to_string(path).unwrap(), "# Updated\n");
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlinked_instruction_files() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("private"), "keep").unwrap();
        std::os::unix::fs::symlink(root.join("private"), root.join("AGENTS.md")).unwrap();
        assert!(write(&root.join("AGENTS.md"), "overwrite", "missing").is_err());
        assert_eq!(fs::read_to_string(root.join("private")).unwrap(), "keep");
    }
}
