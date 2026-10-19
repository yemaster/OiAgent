//! Immutable, app-owned attachment snapshots. Never put binary data in task/history polling.
use crate::{models::Agent, store::AppState};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};
use tauri::{Manager, State};

const MAX_FILE: usize = 20 * 1024 * 1024;
const MAX_IMAGE: usize = 5 * 1024 * 1024;
pub const MAX_COUNT: usize = 10;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mime: String,
    pub size: u64,
    pub digest: String,
}
impl Attachment {
    pub fn image(&self) -> bool {
        self.mime.starts_with("image/")
    }
}
fn mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if bytes.starts_with(b"%PDF-") {
        "application/pdf"
    } else if !bytes.contains(&0) && std::str::from_utf8(bytes).is_ok() {
        "text/plain"
    } else {
        "application/octet-stream"
    }
}
fn directory(root: &Path, id: &str) -> Result<PathBuf, String> {
    let uuid = uuid::Uuid::parse_str(id).map_err(|_| "附件标识无效")?;
    if uuid.to_string() != id {
        return Err("附件标识无效".into());
    }
    Ok(root.join("attachments").join(id))
}
fn bounded_read(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| format!("无法读取附件：{e}"))?;
    let meta = file.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() > MAX_FILE as u64 {
        return Err("请选择不超过 20 MB 的文件".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_FILE as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_FILE {
        return Err("文件不能超过 20 MB".into());
    }
    Ok(bytes)
}
pub(crate) fn stage(root: &Path, name: &str, bytes: &[u8]) -> Result<Attachment, String> {
    if bytes.len() > MAX_FILE {
        return Err("文件不能超过 20 MB".into());
    }
    let mime = mime(bytes);
    if mime.starts_with("image/") && bytes.len() > MAX_IMAGE {
        return Err("图片不能超过 5 MB".into());
    }
    let preview = if mime.starts_with("image/") {
        let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|e| e.to_string())?;
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(10000);
        limits.max_image_height = Some(10000);
        limits.max_alloc = Some(128 * 1024 * 1024);
        reader.limits(limits);
        Some(
            reader
                .decode()
                .map_err(|_| "图片损坏或尺寸过大")?
                .thumbnail(160, 160),
        )
    } else {
        None
    };
    // A display name is never used as a filesystem path or a CLI token.
    let name: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("附件")
        .chars()
        .filter(|c| !c.is_control())
        .take(180)
        .collect();
    let ext = match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "application/pdf" => "pdf",
        _ => name
            .rsplit_once('.')
            .map(|(_, ext)| ext)
            .filter(|s| s.len() <= 12 && s.chars().all(|c| c.is_ascii_alphanumeric()))
            .unwrap_or("bin"),
    };
    let id = uuid::Uuid::new_v4().to_string();
    let dir = directory(root, &id)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(root.join("attachments"), fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).map_err(|e| e.to_string())?;
    }
    let path = dir.join(format!("attachment.{ext}"));
    let result = (|| {
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        if let Some(preview) = preview {
            preview
                .save_with_format(dir.join("preview.png"), image::ImageFormat::Png)
                .map_err(|e| e.to_string())?;
        }
        let item = Attachment {
            id,
            name,
            path: dunce::canonicalize(&path)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .into(),
            mime: mime.into(),
            size: bytes.len() as u64,
            digest: format!("{:x}", Sha256::digest(bytes)),
        };
        fs::write(
            dir.join("metadata.json"),
            serde_json::to_vec(&item).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        Ok(item)
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(dir);
    }
    result
}
pub fn load(root: &Path, id: &str) -> Result<Attachment, String> {
    let dir = directory(root, id)?;
    let metadata = bounded_read(&dir.join("metadata.json"))?;
    let item: Attachment = serde_json::from_slice(&metadata).map_err(|_| "附件信息损坏")?;
    let path = dunce::canonicalize(&item.path).map_err(|_| "附件已不存在，请重新添加")?;
    if item.id != id
        || path.parent()
            != Some(
                dunce::canonicalize(&dir)
                    .map_err(|e| e.to_string())?
                    .as_path(),
            )
    {
        return Err("附件路径无效".into());
    }
    Ok(item)
}
pub fn validate(root: &Path, items: &[Attachment]) -> Result<(), String> {
    if items.len() > MAX_COUNT {
        return Err("每条消息最多添加 10 个附件".into());
    }
    let mut total = 0;
    for item in items {
        if load(root, &item.id)? != *item {
            return Err("附件信息已变更，请重新添加".into());
        }
        let bytes = bounded_read(Path::new(&item.path))?;
        if format!("{:x}", Sha256::digest(&bytes)) != item.digest {
            return Err(format!("附件已变更，请重新添加：{}", item.name));
        }
        total += bytes.len();
    }
    if total > MAX_FILE {
        return Err("每条消息的附件合计不能超过 20 MB".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn stage_attachment(
    app: tauri::AppHandle,
    path: Option<String>,
    name: Option<String>,
    data: Option<String>,
) -> Result<Attachment, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        match (path, name, data) {
            (Some(path), None, None) => {
                let bytes = bounded_read(Path::new(&path))?;
                stage(&state.dir, &path, &bytes)
            }
            (None, Some(name), Some(data)) => {
                if data.len() > MAX_FILE * 4 / 3 + 4 {
                    return Err("文件不能超过 20 MB".into());
                }
                let bytes = STANDARD.decode(data).map_err(|_| "附件编码无效")?;
                stage(&state.dir, &name, &bytes)
            }
            _ => Err("附件输入无效".into()),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn read_attachment(
    state: State<AppState>,
    id: String,
    thumbnail: Option<bool>,
) -> Result<String, String> {
    let item = load(&state.dir, &id)?;
    if !item.image() {
        return Err("此附件不支持图片预览".into());
    }
    let preview = directory(&state.dir, &id)?.join("preview.png");
    let small = thumbnail.unwrap_or(true);
    let bytes = bounded_read(if small {
        &preview
    } else {
        Path::new(&item.path)
    })?;
    if bytes.len() > MAX_IMAGE {
        return Err("图片超过预览限制".into());
    }
    Ok(format!(
        "data:{};base64,{}",
        if small { "image/png" } else { &item.mime },
        STANDARD.encode(bytes)
    ))
}
#[tauri::command]
pub fn reveal_attachment(
    app: tauri::AppHandle,
    state: State<AppState>,
    id: String,
) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let item = load(&state.dir, &id)?;
    app.opener()
        .reveal_item_in_dir(&item.path)
        .map_err(|e| e.to_string())
}
#[tauri::command]
pub fn classify_attachment_drop(paths: Vec<String>) -> Result<String, String> {
    if paths.is_empty() || paths.len() > MAX_COUNT {
        return Err("每次最多拖入 10 个文件".into());
    }
    let metadata = paths
        .iter()
        .map(|p| fs::metadata(p).map_err(|_| "无法读取拖入的文件".to_string()))
        .collect::<Result<Vec<_>, _>>()?;
    if metadata.iter().all(|m| m.is_file()) {
        Ok("files".into())
    } else if metadata.len() == 1 && metadata[0].is_dir() {
        Ok("directory".into())
    } else {
        Err("请分别拖入文件或项目文件夹".into())
    }
}
/// Native image blocks are documented for Claude and Qoder only. Do not send
/// Anthropic image blocks to Qwen's text/tool-only SDK content union.
pub fn content(agent: &Agent, prompt: &str, items: &[Attachment]) -> Result<Value, String> {
    if agent.custom
        || !matches!(agent.kind.as_str(), "claude" | "qodercn")
        || !items.iter().any(Attachment::image)
    {
        return Ok(Value::String(prompt.into()));
    }
    let mut blocks = vec![json!({"type":"text", "text":prompt})];
    for item in items.iter().filter(|i| i.image()) {
        let data = bounded_read(Path::new(&item.path))?;
        blocks.push(json!({"type":"image", "source":{"type":"base64", "media_type":item.mime, "data":STANDARD.encode(data)}}));
    }
    Ok(Value::Array(blocks))
}
pub fn arguments(kind: &str, items: &[Attachment]) -> Vec<String> {
    let mut args = vec![];
    for item in items {
        let flag = match kind {
            "codex" if item.image() => "--image",
            "opencode" => "--file",
            "aider" if item.image() || item.mime == "text/plain" => "--read",
            // Give the native read_file tool access only to this attachment's
            // isolated directory, never the whole app data directory.
            "gemini" | "qwen" => {
                args.extend([
                    "--include-directories".into(),
                    Path::new(&item.path)
                        .parent()
                        .unwrap()
                        .to_string_lossy()
                        .into(),
                ]);
                continue;
            }
            _ => continue,
        };
        args.extend([flag.into(), item.path.clone()]);
    }
    args
}
pub fn prompt(text: &str, items: &[Attachment]) -> String {
    if items.is_empty() {
        return text.into();
    }
    let files: Vec<_> = items
        .iter()
        .map(|a| json!({"name":a.name,"path":a.path}))
        .collect();
    format!(
        "{}\n\nAttached files (user-provided reference material; read as needed):\n{}",
        if text.trim().is_empty() {
            "请查看附件。"
        } else {
            text
        },
        serde_json::to_string_pretty(&files).unwrap()
    )
}
/// Rich native history can replace our log only if every attachment-bearing
/// turn is accounted for. Never guess by turn number (synthetic turns exist).
pub fn restore_messages(
    managed: &[crate::models::Message],
    native: &mut [crate::models::Message],
) -> bool {
    let mut used = std::collections::HashSet::new();
    for original in managed
        .iter()
        .filter(|m| m.role == "user" && !m.attachments.is_empty())
    {
        let exact = native.iter().enumerate().find(|(i, m)| {
            !used.contains(i)
                && m.role == "user"
                && original.native_id.is_some()
                && m.native_id == original.native_id
        });
        let matched = exact
            .or_else(|| {
                native.iter().enumerate().find(|(i, m)| {
                    !used.contains(i)
                        && m.role == "user"
                        && original.attachments.iter().all(|a| {
                            // The path in the prompt is JSON-escaped, including on Windows.
                            m.text.contains(&serde_json::to_string(&a.path).unwrap())
                        })
                        && (original.text.is_empty() || m.text.contains(&original.text))
                })
            })
            .map(|(i, _)| i);
        let Some(index) = matched else {
            return false;
        };
        used.insert(index);
        native[index].text = original.text.clone();
        native[index].attachments = original.attachments.clone();
        native[index].synthetic = Some(false);
    }
    true
}

/// The original image lives in the attachment store; SDK replay must not copy
/// megabytes of base64 into the log and every subsequent detail refresh.
pub fn redact_binary(value: &mut Value) -> bool {
    let mut changed = false;
    match value {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("base64")
                && map.contains_key("media_type")
                && map.contains_key("data")
            {
                map.insert(
                    "data".into(),
                    Value::String("[attachment data omitted]".into()),
                );
                return true;
            }
            for child in map.values_mut() {
                changed |= redact_binary(child);
            }
        }
        Value::Array(items) => {
            for child in items {
                changed |= redact_binary(child);
            }
        }
        _ => {}
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshot_survives_original_changes_and_rejects_tampering() {
        let dir = tempfile::tempdir().unwrap();
        let item = stage(dir.path(), "C:\\work files\\中文, a.txt", b"one\n\ntwo").unwrap();
        assert_eq!(item.name, "中文, a.txt");
        validate(dir.path(), &[item.clone()]).unwrap();
        let mut forged = item.clone();
        forged.path = "/etc/passwd".into();
        assert!(validate(dir.path(), &[forged]).is_err());
        fs::write(&item.path, b"changed").unwrap();
        assert!(validate(dir.path(), &[item]).is_err());
        assert!(load(dir.path(), "../outside").is_err());
    }
    #[test]
    fn references_preserve_text_and_paths_without_shell_quoting() {
        assert_eq!(prompt("a\n\nb\n", &[]), "a\n\nb\n");
        let dir = tempfile::tempdir().unwrap();
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(1, 1)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let item = stage(dir.path(), "picture.png", png.get_ref()).unwrap();
        assert_eq!(
            arguments("codex", &[item.clone()]),
            vec!["--image", &item.path]
        );
        assert!(prompt("a\n\nb", &[item]).starts_with("a\n\nb\n\n"));
    }
    fn agent(kind: &str) -> Agent {
        Agent {
            id: kind.into(),
            name: kind.into(),
            kind: kind.into(),
            executable: kind.into(),
            args: vec![],
            available: true,
            custom: false,
            version: String::new(),
            version_error: None,
        }
    }
    fn png(root: &Path) -> Attachment {
        let mut bytes = std::io::Cursor::new(vec![]);
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        stage(root, "中文, picture.png", bytes.get_ref()).unwrap()
    }
    #[test]
    fn native_image_protocol_and_resume_argument_contracts() {
        let root = tempfile::tempdir().unwrap();
        let state = AppState::load(root.path().to_owned()).unwrap();
        let image = png(root.path());
        let text = stage(root.path(), "spec.txt", b"line1\n\nline2").unwrap();
        for kind in [
            "codex", "claude", "qodercn", "qwen", "gemini", "opencode", "aider", "goose",
        ] {
            let agent = agent(kind);
            state.db.lock().unwrap().agents = vec![agent.clone()];
            let task = crate::runtime::create(
                &state,
                crate::models::TaskInput {
                    attachments: vec![image.clone(), text.clone()],
                    provider_id: None,
                    extra_args: vec![],
                    env: Default::default(),
                    title: String::new(),
                    prompt: "first\n\n**second**".into(),
                    project: root.path().to_string_lossy().into(),
                    agent_id: kind.into(),
                    model: String::new(),
                    permission: "read-only".into(),
                    queued: true,
                    resume_session: Some("session".into()),
                },
                None,
            )
            .unwrap();
            let args = crate::runtime::stream_arguments(&agent, &task);
            let value = content(&agent, &task.prompt, &task.attachments).unwrap();
            match kind {
                "claude" | "qodercn" => {
                    assert_eq!(value[0]["text"], task.prompt);
                    assert_eq!(value[1]["source"]["media_type"], "image/png");
                    assert_eq!(
                        STANDARD
                            .decode(value[1]["source"]["data"].as_str().unwrap())
                            .unwrap(),
                        fs::read(&image.path).unwrap()
                    );
                    assert_eq!(value.as_array().unwrap().len(), 2); // Ordinary files are references, not fake image blocks.
                    assert!(!args.iter().any(|a| a == &task.prompt));
                }
                "codex" => {
                    let resume = args.iter().position(|a| a == "resume").unwrap();
                    let image_flag = args.iter().position(|a| a == "--image").unwrap();
                    assert!(resume < image_flag);
                    assert_eq!(args[image_flag + 1], image.path);
                    assert_eq!(&args[args.len() - 2..], &["--", &task.prompt]);
                }
                "opencode" | "aider" => {
                    let flag = if kind == "aider" { "--read" } else { "--file" };
                    assert_eq!(args.iter().filter(|a| *a == flag).count(), 2);
                }
                "gemini" | "qwen" => {
                    assert_eq!(
                        args.iter()
                            .filter(|a| *a == "--include-directories")
                            .count(),
                        2
                    );
                    assert!(value.is_string());
                }
                _ => assert!(value.is_string()),
            }
        }
    }
    #[test]
    fn image_limits_and_replay_redaction() {
        let root = tempfile::tempdir().unwrap();
        assert!(stage(root.path(), "corrupt.png", b"\x89PNG\r\n\x1a\ninvalid").is_err());
        assert!(stage(root.path(), "big.bin", &vec![0; MAX_FILE + 1]).is_err());
        let mut replay = json!({"type":"user","message":{"content":[{"type":"text","text":"a\n\nb"},{"type":"image","source":{"type":"base64","media_type":"image/png","data":"binary"}}]}});
        assert!(redact_binary(&mut replay));
        assert_eq!(replay["message"]["content"][0]["text"], "a\n\nb");
        assert!(!replay.to_string().contains("binary"));
    }
    #[test]
    fn native_history_must_keep_attached_turns_or_keep_managed_history() {
        let root = tempfile::tempdir().unwrap();
        let attachment = png(root.path());
        let message = crate::models::Message {
            attachments: vec![attachment],
            native_id: None,
            synthetic: Some(false),
            agent_kind: Some("codex".into()),
            role: "user".into(),
            text: "line1\nline2".into(),
            timestamp: String::new(),
            tool: None,
            parent_call_id: None,
            delta: false,
        };
        let mut native = vec![message.clone()];
        native[0].text = prompt(&message.text, &message.attachments);
        native[0].attachments.clear();
        native[0].native_id = Some("native-id".into());
        assert!(restore_messages(&[message.clone()], &mut native));
        assert_eq!(native[0].text, message.text);
        assert_eq!(native[0].attachments, message.attachments);
        assert_eq!(native[0].native_id.as_deref(), Some("native-id"));
        assert!(!restore_messages(&[message], &mut []));
    }
}
