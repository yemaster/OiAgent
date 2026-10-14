//! Bounded, referenced-file evidence. Never crawl the workspace or follow links out of it.
use super::*;
use std::{
    collections::HashSet,
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Component, Path, PathBuf},
};

const MAX_FILES: usize = 32;
const FILE_BYTES: usize = 48 * 1024;
const EVIDENCE_BYTES: usize = 192 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub path: String,
    pub project: String,
    pub relative_path: String,
    pub step_ids: Vec<String>,
    pub size: u64,
    pub error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactList {
    pub files: Vec<Artifact>,
    pub truncated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub content: String,
    pub truncated: bool,
    pub revision: String,
}

fn without_location(mut path: &str) -> &str {
    for _ in 0..2 {
        if let Some((file, suffix)) = path.rsplit_once(':') {
            if !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit()) {
                path = file;
            }
        }
    }
    path
}
fn looks_like_file(s: &str) -> bool {
    let s = without_location(s);
    !s.contains("://")
        && !s.contains('\n')
        && s.len() < 4096
        && Path::new(s)
            .extension()
            .and_then(|v| v.to_str())
            .is_some_and(|ext| {
                !ext.is_empty() && ext.len() <= 12 && ext.chars().all(|c| c.is_ascii_alphanumeric())
            })
}
fn references(text: &str, paths: &mut Vec<String>) {
    // Delimited paths keep spaces; plain paths cover CLI output and Markdown lists.
    for (i, part) in text.split('`').enumerate() {
        if i % 2 == 1 && looks_like_file(part) {
            paths.push(part.into());
        }
    }
    for part in text.split("](").skip(1) {
        if let Some((path, _)) = part.split_once(')') {
            let path = path.trim_matches(|c| c == '<' || c == '>');
            if looks_like_file(path) {
                paths.push(path.into());
            }
        }
    }
    for token in text.split(|c: char| c.is_whitespace() || "（），。；：、".contains(c)) {
        let token = token
            .trim_matches(|c: char| "`\"'()[]{}<>,;，。；：、".contains(c))
            .trim_start_matches('@');
        if !token.contains(['[', ']', '(', ')', '`']) && looks_like_file(token) {
            paths.push(token.into());
        }
    }
}
fn tool_paths(value: &serde_json::Value, paths: &mut Vec<String>, depth: usize) {
    if depth > 12 || paths.len() > 512 {
        return;
    }
    match value {
        serde_json::Value::Object(fields) => {
            for (key, value) in fields {
                if [
                    "path",
                    "file_path",
                    "filePath",
                    "absolute_path",
                    "target_file",
                ]
                .contains(&key.as_str())
                {
                    if let Some(path) = value.as_str() {
                        paths.push(path.into());
                    }
                }
                tool_paths(value, paths, depth + 1);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values.iter().take(128) {
                tool_paths(value, paths, depth + 1);
            }
        }
        serde_json::Value::String(text) => {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(text) {
                if !parsed.is_string() {
                    tool_paths(&parsed, paths, depth + 1);
                }
            }
            references(text, paths);
        }
        _ => {}
    }
}
fn step_paths(state: &AppState, run: &Run, index: usize) -> Vec<String> {
    let mut paths = Vec::new();
    references(&run.steps[index].output, &mut paths);
    if let Some(id) = run.steps[index].task_ids.last() {
        let path = state.dir.join("logs").join(format!("{id}.messages.jsonl"));
        if let Ok(mut file) = fs::File::open(path) {
            let len = file.metadata().map(|m| m.len()).unwrap_or(0);
            let _ = file.seek(SeekFrom::Start(len.saturating_sub(512 * 1024)));
            let mut data = Vec::new();
            let _ = file.take(512 * 1024).read_to_end(&mut data);
            for line in String::from_utf8_lossy(&data).lines() {
                if let Ok(message) = serde_json::from_str::<Message>(line) {
                    if message.role == "assistant" {
                        references(&message.text, &mut paths);
                    }
                    if let Some(tool) = message.tool {
                        tool_paths(&tool, &mut paths, 0);
                    }
                }
                if paths.len() > 512 {
                    break;
                }
            }
        }
    }
    paths
}
fn roots(project: &str, home: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from(project)];
    if let Some(home) = home {
        for agent in [".claude", ".codex", ".qwen", ".gemini"] {
            roots.push(home.join(agent).join("plans"));
        }
    }
    roots
}
fn sensitive(path: &Path) -> bool {
    path.components().any(|part| {
        let name = part.as_os_str().to_string_lossy().to_lowercase();
        name.starts_with(".env")
            || [
                ".git",
                ".ssh",
                ".aws",
                ".azure",
                "credentials",
                "credentials.json",
                "auth.json",
                "secrets.json",
                "secrets.yaml",
                "id_rsa",
                "id_ed25519",
            ]
            .contains(&name.as_str())
            || name.ends_with(".pem")
            || name.ends_with(".key")
            || name.ends_with(".p12")
    })
}
fn locate(project: &str, raw: &str, home: Option<&Path>) -> Result<(String, String), String> {
    let raw = raw.split('#').next().unwrap_or(raw);
    let raw = without_location(raw);
    let path = if let Some(rel) = raw.strip_prefix("~/") {
        home.ok_or("无法读取用户目录")?.join(rel)
    } else {
        PathBuf::from(raw)
    };
    if sensitive(&path) || path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("此文件不自动共享".into());
    }
    let candidates = roots(project, home);
    for root in &candidates {
        let relative = if path.is_absolute() {
            path.strip_prefix(root).ok()
        } else if root == &candidates[0] {
            Some(path.as_path())
        } else {
            None
        };
        if let Some(relative) = relative {
            return Ok((
                root.to_string_lossy().into_owned(),
                relative.to_string_lossy().into_owned(),
            ));
        }
    }
    Err("文件位于共享范围外".into())
}

pub(super) fn collect(state: &AppState, run: &Run, indices: &[usize]) -> ArtifactList {
    collect_at(state, run, indices, dirs::home_dir().as_deref())
}
fn collect_at(state: &AppState, run: &Run, indices: &[usize], home: Option<&Path>) -> ArtifactList {
    let mut result = ArtifactList {
        files: Vec::new(),
        truncated: false,
    };
    let mut seen = HashSet::new();
    for &index in indices.iter().rev() {
        if run.definition.steps[index].kind != "agent" {
            continue;
        }
        for raw in step_paths(state, run, index) {
            let located = locate(&run.project, &raw, home);
            let (project, relative_path, mut error) = match located {
                Ok((project, path)) => (project, path, None),
                Err(error) => (String::new(), raw.clone(), Some(error)),
            };
            let path = if project.is_empty() {
                raw
            } else {
                Path::new(&project)
                    .join(&relative_path)
                    .to_string_lossy()
                    .into_owned()
            };
            if !seen.insert(path.clone()) {
                if let Some(file) = result.files.iter_mut().find(|file| file.path == path) {
                    let id = &run.definition.steps[index].id;
                    if !file.step_ids.contains(id) {
                        file.step_ids.push(id.clone());
                    }
                }
                continue;
            }
            if result.files.len() >= MAX_FILES {
                result.truncated = true;
                continue;
            }
            let size = if error.is_none() {
                match crate::files::checked_path(&project, &relative_path)
                    .and_then(|path| fs::metadata(path).map_err(|e| e.to_string()))
                {
                    Ok(meta) if meta.is_file() => meta.len(),
                    Ok(_) => continue,
                    Err(e) => {
                        error = Some(e);
                        0
                    }
                }
            } else {
                0
            };
            result.files.push(Artifact {
                path,
                project,
                relative_path,
                step_ids: vec![run.definition.steps[index].id.clone()],
                size,
                error,
            });
        }
    }
    result
}
fn read(file: &Artifact, limit: usize) -> Result<Preview, String> {
    use sha2::{Digest, Sha256};
    if let Some(error) = &file.error {
        return Err(error.clone());
    }
    let ext = Path::new(&file.relative_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if [
        "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "png", "jpg", "jpeg", "gif", "webp",
        "zip", "exe", "dmg", "mp4",
    ]
    .contains(&ext.as_str())
    {
        return Err("此格式暂不支持正文预览，请使用系统程序打开".into());
    }
    let path = crate::files::checked_path(&file.project, &file.relative_path)?;
    let source = fs::File::open(path).map_err(|e| e.to_string())?;
    if !source.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("请选择普通文件".into());
    }
    let mut bytes = Vec::new();
    source
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    let truncated = bytes.len() > limit;
    bytes.truncate(limit);
    if bytes.contains(&0) {
        return Err("暂不读取二进制产物，请使用系统程序打开".into());
    }
    let content = match std::str::from_utf8(&bytes) {
        Ok(text) => text.to_owned(),
        Err(e) if truncated && e.error_len().is_none() => {
            String::from_utf8_lossy(&bytes[..e.valid_up_to()]).into_owned()
        }
        Err(_) => return Err("暂不读取非 UTF-8 产物".into()),
    };
    Ok(Preview {
        content,
        truncated,
        revision: format!("{:x}", Sha256::digest(&bytes)),
    })
}
pub(super) fn evidence(state: &AppState, run: &Run, indices: &[usize]) -> serde_json::Value {
    evidence_with_limit(state, run, indices, EVIDENCE_BYTES)
}
pub(super) fn handoff(state: &AppState, run: &Run, indices: &[usize]) -> serde_json::Value {
    evidence_with_limit(state, run, indices, 16 * 1024)
}
fn evidence_with_limit(
    state: &AppState,
    run: &Run,
    indices: &[usize],
    limit: usize,
) -> serde_json::Value {
    let completed: Vec<_> = indices
        .iter()
        .copied()
        .filter(|&i| run.steps[i].status == "completed")
        .collect();
    let list = collect(state, run, &completed);
    let mut budget = limit;
    let files: Vec<_> = list
        .files
        .iter()
        .map(|file| {
            let mut value =
                serde_json::json!({"path":file.path,"stepIds":file.step_ids,"size":file.size});
            if budget == 0 {
                value["error"] = "证据总量达到上限，未读取正文".into();
            } else {
                match read(file, FILE_BYTES.min(budget)) {
                    Ok(preview) => {
                        budget = budget.saturating_sub(preview.content.len());
                        value["content"] = preview.content.into();
                        value["truncated"] = preview.truncated.into();
                        value["excerptHash"] = preview.revision.into();
                    }
                    Err(error) => value["error"] = error.into(),
                }
            }
            value
        })
        .collect();
    serde_json::json!({"files":files,"truncated":list.truncated})
}
#[tauri::command]
pub async fn workflow_artifacts(app: tauri::AppHandle, id: String) -> Result<ArtifactList, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let run = get(&state, &id)?;
        Ok(collect(
            &state,
            &run,
            &(0..run.steps.len()).collect::<Vec<_>>(),
        ))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn workflow_artifact(
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<Preview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let run = get(&state, &id)?;
        let list = collect(&state, &run, &(0..run.steps.len()).collect::<Vec<_>>());
        let file = list
            .files
            .iter()
            .find(|file| file.path == path)
            .ok_or("产物不在此工作流中")?;
        read(file, 256 * 1024)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn resolves_referenced_plan_files_but_rejects_private_paths_and_symlinks() {
        let temp = tempfile::tempdir().unwrap();
        let project = temp.path().join("project");
        let home = temp.path().join("home");
        fs::create_dir_all(&project).unwrap();
        fs::create_dir_all(home.join(".claude/plans")).unwrap();
        let plan = home.join(".claude/plans/analysis report.md");
        fs::write(&plan, "Plan body").unwrap();
        let root = project.to_str().unwrap();
        let (project, relative_path) = locate(root, plan.to_str().unwrap(), Some(&home)).unwrap();
        let file = Artifact {
            path: plan.to_string_lossy().into_owned(),
            project,
            relative_path,
            step_ids: vec![],
            size: 9,
            error: None,
        };
        assert_eq!(read(&file, 100).unwrap().content, "Plan body");
        for path in [
            "../secret.md",
            ".env.local",
            ".git/config",
            "secrets.json",
            "auth.json",
            "~/.ssh/id_rsa",
            "~/.claude/settings.json",
        ] {
            assert!(locate(root, path, Some(&home)).is_err(), "{path}");
        }
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&plan, Path::new(root).join("link.md")).unwrap();
            let file = Artifact {
                project: root.into(),
                relative_path: "link.md".into(),
                ..file
            };
            assert!(read(&file, 100).is_err());
        }
    }
    #[test]
    fn extracts_markdown_tool_paths_and_marks_truncated_evidence() {
        let mut paths = Vec::new();
        references(
            "文件 `plans/report v2.md`、[汇总](summary.md)，见 src/main.rs:12:3",
            &mut paths,
        );
        tool_paths(
            &serde_json::json!({"input":"{\"file_path\":\"output/data.json\"}"}),
            &mut paths,
            0,
        );
        assert!(paths.contains(&"plans/report v2.md".into()));
        assert!(paths.contains(&"summary.md".into()));
        assert!(paths.contains(&"output/data.json".into()));
        assert_eq!(without_location("src/main.rs:12:3"), "src/main.rs");
        assert_eq!(without_location("artifact.mp4"), "artifact.mp4");
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("large.md"), "多".repeat(100)).unwrap();
        let file = Artifact {
            path: "large.md".into(),
            project: dir.path().to_string_lossy().into_owned(),
            relative_path: "large.md".into(),
            size: 300,
            step_ids: vec![],
            error: None,
        };
        let preview = read(&file, 10).unwrap();
        assert!(preview.truncated);
        assert_eq!(preview.content, "多多多");
    }
}
