use crate::store::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::State;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scope {
    pub kind: String,
    pub project: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationView {
    config_path: String,
    skills_path: String,
    revision: String,
    servers: Vec<Value>,
    skills: Vec<Value>,
    warnings: Vec<String>,
}
fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub(crate) fn secure_path(path: &Path) -> Result<(), String> {
    for part in path.ancestors() {
        if fs::symlink_metadata(part).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err("配置路径包含符号链接，请在程序的原生配置中管理".into());
        }
    }
    Ok(())
}
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    secure_path(path)?;
    let parent = path.parent().ok_or("无效路径")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.to_string())?;
    Ok(())
}
fn read(path: &Path) -> Result<Vec<u8>, String> {
    secure_path(path)?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut bytes = vec![];
    fs::File::open(path)
        .map_err(|e| e.to_string())?
        .take(4 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("配置文件超过 4 MB".into());
    }
    Ok(bytes)
}
fn checked_name(name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.len() > 64
        || !name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return Err("名称只能包含字母、数字、短横线和下划线（最多 64 字符）".into());
    }
    Ok(())
}
fn paths(home: &Path, scope: &Scope) -> Result<(PathBuf, Vec<PathBuf>), String> {
    let base = if let Some(project) = &scope.project {
        let p = PathBuf::from(project)
            .canonicalize()
            .map_err(|_| "项目目录不存在")?;
        if !p.is_dir() {
            return Err("请选择项目目录".into());
        }
        p
    } else {
        home.to_path_buf()
    };
    let user = scope.project.is_none();
    let (config, skills) = match scope.kind.as_str() {
        "codex" => {
            let codex = if user {
                std::env::var_os("CODEX_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| base.join(".codex"))
            } else {
                base.join(".codex")
            };
            (
                codex.join("config.toml"),
                vec![base.join(".agents/skills"), codex.join("skills")],
            )
        }
        "claude" => (
            base.join(if user { ".claude.json" } else { ".mcp.json" }),
            vec![base.join(".claude/skills")],
        ),
        "qwen" => (
            base.join(".qwen/settings.json"),
            vec![base.join(".qwen/skills")],
        ),
        "gemini" => (
            base.join(".gemini/settings.json"),
            vec![base.join(".gemini/skills"), base.join(".agents/skills")],
        ),
        "opencode" => {
            let config = if user {
                std::env::var_os("XDG_CONFIG_HOME")
                    .map(PathBuf::from)
                    .unwrap_or_else(|| base.join(".config"))
                    .join("opencode/opencode.json")
            } else {
                base.join("opencode.json")
            };
            let config = if config.with_extension("jsonc").exists() {
                config.with_extension("jsonc")
            } else {
                config
            };
            let skills = if user {
                config.parent().unwrap().join("skills")
            } else {
                base.join(".opencode/skills")
            };
            (config, vec![skills, base.join(".agents/skills")])
        }
        _ => return Err("该 Agent 暂无已适配的原生 MCP / Skills 配置格式".into()),
    };
    Ok((config, skills))
}
fn root_key(kind: &str) -> &'static str {
    if kind == "codex" {
        "mcp_servers"
    } else if kind == "opencode" {
        "mcp"
    } else {
        "mcpServers"
    }
}
fn parse(bytes: &[u8], kind: &str) -> Result<Value, String> {
    if bytes.is_empty() {
        return Ok(json!({}));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "配置不是 UTF-8")?;
    let value = if kind == "codex" {
        toml_edit::de::from_str::<Value>(text).map_err(|e| e.to_string())?
    } else {
        json5::from_str(text).map_err(|e| e.to_string())?
    };
    if !value.is_object() {
        return Err("配置根节点必须是对象".into());
    }
    Ok(value)
}
fn skill_metadata(content: &str) -> Result<(String, String), String> {
    let normalized = content.replace("\r\n", "\n");
    let front = normalized
        .strip_prefix("---\n")
        .and_then(|s| s.split_once("\n---").map(|p| p.0))
        .ok_or("SKILL.md 需要包含 name 和 description 的 YAML frontmatter")?;
    let meta: Value = serde_yaml_ng::from_str(front).map_err(|e| e.to_string())?;
    let name = meta["name"].as_str().ok_or("缺少 name")?;
    checked_name(name)?;
    let description = meta["description"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or("缺少 description")?;
    Ok((name.into(), description.into()))
}
fn view(home: &Path, scope: &Scope) -> Result<IntegrationView, String> {
    let (path, roots) = paths(home, scope)?;
    let bytes = read(&path)?;
    let config = parse(&bytes, &scope.kind)?;
    let servers = config[root_key(&scope.kind)]
        .as_object()
        .map(|m| {
            m.iter()
                .map(|(name, config)| json!({"name":name,"config":config}))
                .collect()
        })
        .unwrap_or_default();
    let mut skills = vec![];
    let mut warnings = vec![];
    for (index, root) in roots.iter().enumerate() {
        if !root.exists() {
            continue;
        }
        if let Err(e) = secure_path(root) {
            warnings.push(e);
            continue;
        }
        for entry in fs::read_dir(root)
            .map_err(|e| e.to_string())?
            .flatten()
            .take(1000)
        {
            let path = entry.path().join("SKILL.md");
            if !path.exists() {
                continue;
            }
            match read(&path).and_then(|b| String::from_utf8(b).map_err(|e| e.to_string())) {
                Ok(content) => match skill_metadata(&content) {
                    Ok((name, description)) => skills.push(json!({"id":format!("{index}:{}", entry.file_name().to_string_lossy()),"name":name,"description":description,"path":path,"revision":revision(content.as_bytes()),"content":content})),
                    Err(e) => warnings.push(format!("{}：{e}", path.display())),
                },
                Err(e) => warnings.push(format!("{}：{e}", path.display())),
            }
        }
    }
    skills.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(IntegrationView {
        config_path: path.to_string_lossy().into(),
        skills_path: roots[0].to_string_lossy().into(),
        revision: revision(&bytes),
        servers,
        skills,
        warnings,
    })
}
fn save_mcp(
    home: &Path,
    scope: &Scope,
    name: &str,
    config: Option<Value>,
    expected: &str,
) -> Result<(), String> {
    checked_name(name)?;
    let (path, _) = paths(home, scope)?;
    let bytes = read(&path)?;
    if revision(&bytes) != expected {
        return Err("配置已被其他程序修改，请刷新后重试".into());
    }
    if let Some(v) = &config {
        if !v.is_object() || v.as_object().unwrap().is_empty() {
            return Err("MCP 配置必须是非空对象".into());
        }
        let command_ok = if scope.kind == "opencode" {
            v["command"].as_array().is_some_and(|a| {
                a.first()
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.trim().is_empty())
                    && a.iter().all(Value::is_string)
            })
        } else {
            v["command"].as_str().is_some_and(|s| !s.trim().is_empty())
        };
        let url_ok = v
            .get("url")
            .or_else(|| v.get("httpUrl"))
            .and_then(Value::as_str)
            .is_some_and(|s| {
                reqwest::Url::parse(s).is_ok_and(|u| {
                    ["http", "https"].contains(&u.scheme()) && u.host_str().is_some()
                })
            });
        if !command_ok && !url_ok {
            return Err("请设置有效的启动命令或 HTTP(S) 地址".into());
        }
    }
    let mut root = parse(&bytes, &scope.kind)?;
    let key = root_key(&scope.kind);
    if root.get(key).is_some_and(|v| !v.is_object()) {
        return Err("原 MCP 配置格式异常，未修改文件".into());
    }
    if root.get(key).is_none() {
        root[key] = json!({});
    }
    let map = root[key].as_object_mut().unwrap();
    match &config {
        Some(c) => {
            map.insert(name.into(), c.clone());
        }
        None => {
            map.remove(name);
        }
    }
    let output = if scope.kind == "codex" {
        let text = std::str::from_utf8(&bytes).map_err(|e| e.to_string())?;
        let mut doc = text
            .parse::<toml_edit::DocumentMut>()
            .map_err(|e| e.to_string())?;
        // Modify only the relevant table, retaining unrelated TOML comments and ordering.
        let fragment = toml_edit::ser::to_string_pretty(&root[key]).map_err(|e| e.to_string())?;
        let replacement = fragment
            .parse::<toml_edit::DocumentMut>()
            .map_err(|e| e.to_string())?;
        doc[key] = toml_edit::Item::Table(replacement.as_table().clone());
        doc.to_string()
    } else {
        serde_json::to_string_pretty(&root).map_err(|e| e.to_string())? + "\n"
    };
    if !bytes.is_empty() {
        let backup = path.with_file_name(format!(
            "{}.oiagent-{}.bak",
            path.file_name().unwrap().to_string_lossy(),
            chrono::Utc::now().format("%Y%m%d-%H%M%S-%f")
        ));
        atomic_write(&backup, &bytes)?;
    }
    atomic_write(&path, output.as_bytes())
}
fn skill_path(home: &Path, scope: &Scope, id: &str) -> Result<PathBuf, String> {
    let (_, roots) = paths(home, scope)?;
    let (index, name) = id.split_once(':').unwrap_or(("0", id));
    checked_name(name)?;
    let root = roots
        .get(index.parse::<usize>().map_err(|_| "Skill 位置无效")?)
        .ok_or("Skill 位置无效")?;
    let path = root.join(name).join("SKILL.md");
    secure_path(&path)?;
    Ok(path)
}
#[tauri::command]
pub fn integration_view(state: State<AppState>, scope: Scope) -> Result<IntegrationView, String> {
    let _lock = state.config_lock.lock().unwrap();
    view(&dirs::home_dir().ok_or("无法读取用户目录")?, &scope)
}
#[tauri::command]
pub fn integration_save_mcp(
    state: State<AppState>,
    scope: Scope,
    name: String,
    config: Option<Value>,
    expected: String,
) -> Result<(), String> {
    let _lock = state.config_lock.lock().unwrap();
    save_mcp(
        &dirs::home_dir().ok_or("无法读取用户目录")?,
        &scope,
        &name,
        config,
        &expected,
    )
}
#[tauri::command]
pub fn integration_save_skill(
    state: State<AppState>,
    scope: Scope,
    id: String,
    content: String,
    expected: String,
) -> Result<crate::files::FileContent, String> {
    let _lock = state.config_lock.lock().unwrap();
    save_skill(
        &dirs::home_dir().ok_or("无法读取用户目录")?,
        &scope,
        &id,
        content,
        &expected,
    )
}
fn save_skill(
    home: &Path,
    scope: &Scope,
    id: &str,
    content: String,
    expected: &str,
) -> Result<crate::files::FileContent, String> {
    if content.len() > 256 * 1024 {
        return Err("Skill 文档超过 256 KB".into());
    }
    let (name, _) = skill_metadata(&content)?;
    let path = skill_path(home, scope, id)?;
    if path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        != Some(&name)
    {
        return Err("SKILL.md 中的 name 必须与文件夹名称一致".into());
    }
    let old = read(&path)?;
    if revision(&old) != expected {
        return Err("Skill 已修改，请刷新后重试".into());
    }
    if !old.is_empty() {
        atomic_write(&path.with_extension("md.oiagent.bak"), &old)?;
    }
    atomic_write(&path, content.as_bytes())?;
    Ok(crate::files::FileContent {
        revision: revision(content.as_bytes()),
        content,
    })
}
#[tauri::command]
pub fn integration_import_skill(
    state: State<AppState>,
    scope: Scope,
    source: String,
) -> Result<(), String> {
    let _lock = state.config_lock.lock().unwrap();
    let root = PathBuf::from(source)
        .canonicalize()
        .map_err(|_| "Skill 目录不存在")?;
    let content = String::from_utf8(read(&root.join("SKILL.md"))?).map_err(|e| e.to_string())?;
    let (name, _) = skill_metadata(&content)?;
    let target = skill_path(&dirs::home_dir().ok_or("无法读取用户目录")?, &scope, &name)?
        .parent()
        .unwrap()
        .to_path_buf();
    if target.exists() {
        return Err("同名 Skill 已存在，请先编辑现有 Skill".into());
    }
    // Validate the entire bundle before writing anything; never follow links or execute scripts.
    let mut files = vec![];
    let mut size = 0;
    for entry in walkdir::WalkDir::new(&root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            ![".git", "node_modules", ".DS_Store"]
                .contains(&e.file_name().to_string_lossy().as_ref())
        })
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.file_type().is_symlink() {
            return Err("Skill 包含符号链接，未导入".into());
        }
        if entry.file_type().is_dir() {
            continue;
        }
        if !entry.file_type().is_file() {
            return Err("Skill 包含特殊文件，未导入".into());
        }
        let mut bytes = vec![];
        fs::File::open(entry.path())
            .map_err(|e| e.to_string())?
            .take(10 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        size += bytes.len();
        if size > 10 * 1024 * 1024 || files.len() >= 500 {
            return Err("Skill 最多 500 个文件、10 MB".into());
        }
        files.push((
            entry.path().strip_prefix(&root).unwrap().to_path_buf(),
            bytes,
        ));
    }
    let parent = target.parent().unwrap();
    secure_path(parent)?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = tempfile::tempdir_in(parent).map_err(|e| e.to_string())?;
    for (path, bytes) in files {
        atomic_write(&temp.path().join(path), &bytes)?;
    }
    fs::rename(temp.path(), &target).map_err(|e| e.to_string())?;
    Ok(())
}
#[tauri::command]
pub fn integration_remove_skill(
    state: State<AppState>,
    scope: Scope,
    id: String,
    expected: String,
) -> Result<(), String> {
    let _lock = state.config_lock.lock().unwrap();
    let path = skill_path(&dirs::home_dir().ok_or("无法读取用户目录")?, &scope, &id)?;
    let bytes = read(&path)?;
    if bytes.is_empty() || revision(&bytes) != expected {
        return Err("Skill 已修改或移除，请刷新后重试".into());
    }
    let source = path.parent().unwrap();
    let archive = source
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("oiagent-skill-backups");
    secure_path(&archive)?;
    fs::create_dir_all(&archive).map_err(|e| e.to_string())?;
    fs::rename(
        source,
        archive.join(format!(
            "{}-{}",
            source.file_name().unwrap().to_string_lossy(),
            uuid::Uuid::new_v4()
        )),
    )
    .map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn mcp_preserves_other_fields_and_rejects_stale_revision() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().canonicalize().unwrap();
        for kind in ["claude", "qwen", "gemini", "opencode", "codex"] {
            let scope = Scope {
                kind: kind.into(),
                project: Some(home.to_string_lossy().into()),
            };
            let (path, _) = paths(&home, &scope).unwrap();
            let original = if kind == "codex" {
                "# keep me\nmodel = 'test'\n"
            } else {
                "{\"model\":\"test\",\"other\":{\"keep\":true}}"
            };
            atomic_write(&path, original.as_bytes()).unwrap();
            let config = if kind == "opencode" {
                json!({"type":"local","command":["example","--mcp"]})
            } else {
                json!({"command":"example","args":["--mcp"]})
            };
            let rev = revision(original.as_bytes());
            save_mcp(&home, &scope, "test-server", Some(config), &rev).unwrap();
            let bytes = read(&path).unwrap();
            assert_eq!(parse(&bytes, kind).unwrap()["model"], "test");
            assert_eq!(view(&home, &scope).unwrap().servers.len(), 1);
            assert!(save_mcp(&home, &scope, "test-server", None, &rev).is_err());
            if kind == "codex" {
                assert!(String::from_utf8(bytes).unwrap().contains("# keep me"));
            }
        }
    }
    #[test]
    fn skill_editor_save_returns_revision_preserves_backup_and_rejects_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let home = dir.path().canonicalize().unwrap();
        let scope = Scope {
            kind: "claude".into(),
            project: None,
        };
        let content = "---\nname: review\ndescription: Review changes\n---\nInstructions.\n";
        let first = save_skill(&home, &scope, "review", content.into(), &revision(b"")).unwrap();
        let second = save_skill(
            &home,
            &scope,
            "0:review",
            format!("{content}More instructions.\n"),
            &first.revision,
        )
        .unwrap();
        let path = skill_path(&home, &scope, "0:review").unwrap();
        assert_eq!(
            std::fs::read_to_string(path.with_extension("md.oiagent.bak")).unwrap(),
            content
        );
        assert_eq!(second.revision, revision(second.content.as_bytes()));
        assert!(save_skill(&home, &scope, "0:review", content.into(), &first.revision).is_err());
        assert!(save_skill(
            &home,
            &scope,
            "0:review",
            "Missing metadata".into(),
            &second.revision
        )
        .is_err());
        assert_eq!(std::fs::read_to_string(path).unwrap(), second.content);
    }
    #[test]
    fn skills_validate_metadata_and_paths() {
        assert!(checked_name("../outside").is_err());
        assert!(skill_metadata("no frontmatter").is_err());
        assert_eq!(
            skill_metadata("---\nname: review\ndescription: Review code\n---\nBe precise.")
                .unwrap()
                .0,
            "review"
        );
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_config() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().canonicalize().unwrap();
        fs::write(root.join("actual"), "secret").unwrap();
        std::os::unix::fs::symlink(root.join("actual"), root.join("link")).unwrap();
        assert!(atomic_write(&root.join("link"), b"changed").is_err());
        assert_eq!(fs::read_to_string(root.join("actual")).unwrap(), "secret");
    }
}
