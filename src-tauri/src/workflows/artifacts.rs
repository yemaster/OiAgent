//! Verified deliverables and bounded reference evidence. Never crawl the workspace.
mod logs;
mod writes;
use super::*;
pub(crate) use logs::LogCache;
use std::{
    collections::HashSet,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

const MAX_FILES: usize = 32;
const MAX_LIST_FILES: usize = 1000;
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
    let mut plain = text.to_owned();
    let quotes: Vec<_> = text.match_indices('`').map(|(i, _)| i).collect();
    for pair in quotes.chunks_exact(2) {
        let part = &text[pair[0] + 1..pair[1]];
        if looks_like_file(part) {
            paths.push(part.into());
        }
        plain.replace_range(pair[0]..pair[1] + 1, &" ".repeat(pair[1] + 1 - pair[0]));
    }
    for (start, _) in text.match_indices("](") {
        let part = &text[start + 2..];
        if let Some((path, _)) = part.split_once(')') {
            let end = start + 2 + path.len() + 1;
            let begin = text[..start].rfind('[').unwrap_or(start);
            plain.replace_range(begin..end, &" ".repeat(end - begin));
            let path = path.trim_matches(|c| c == '<' || c == '>');
            if looks_like_file(path) {
                paths.push(path.into());
            }
        }
    }
    for token in plain.split(|c: char| c.is_whitespace() || "（），。；：、".contains(c)) {
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
// Explicit publications prioritize final outputs and support shell-generated files.
// Successful file mutations are collected independently of publication prose.
fn declared_paths(text: &str) -> Option<Vec<String>> {
    let mut paths = None;
    let mut in_section = false;
    let mut fenced = false;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("```") || line.starts_with("~~~") {
            fenced = !fenced;
            continue;
        }
        if fenced {
            continue;
        }
        if line.starts_with('#') {
            let title = line
                .trim_start_matches('#')
                .trim()
                .trim_end_matches([':', '：']);
            in_section = title == "最终产物" || title.eq_ignore_ascii_case("Final deliverables");
            if in_section {
                paths = Some(Vec::new());
            }
            continue;
        }
        if in_section {
            let paths = paths.as_mut().unwrap();
            // Prefer explicit links/quoted paths, preserving spaces without also
            // interpreting the individual words of a file name as extra files.
            let before = paths.len();
            for part in line.split("](").skip(1) {
                if let Some((path, _)) = part.split_once(')') {
                    let path = path.trim_matches(['<', '>']);
                    if !path.contains("://") && !path.is_empty() {
                        paths.push(path.into());
                    }
                }
            }
            for (i, part) in line.split('`').enumerate() {
                if i % 2 == 1 && !part.is_empty() && !part.contains("://") {
                    paths.push(part.into());
                }
            }
            if before == paths.len() {
                let path = line.trim_start_matches(['-', '*', ' ']);
                if looks_like_file(path) {
                    paths.push(path.into());
                }
            }
        }
    }
    paths
}

fn step_paths(
    state: &AppState,
    run: &Run,
    index: usize,
    include_evidence: bool,
) -> (String, Vec<String>, Vec<String>) {
    let mut paths = Vec::new();
    let mut changed = Vec::new();
    let mut final_message = run.steps[index].output.clone();
    if include_evidence {
        references(&final_message, &mut paths);
    }
    for id in &run.steps[index].task_ids {
        let path = state.dir.join("logs").join(format!("{id}.messages.jsonl"));
        if let Ok(summary) = state.artifact_logs.lock().unwrap().read(&path) {
            changed.extend(summary.written);
            if Some(id) != run.steps[index].task_ids.last() {
                continue;
            }
            for message in &summary.messages {
                if message.role == "assistant" && message.tool.is_none() {
                    if include_evidence {
                        references(&message.text, &mut paths);
                    }
                    if !message.text.trim().is_empty() {
                        final_message = message.text.clone();
                    }
                }
                if include_evidence {
                    if let Some(tool) = &message.tool {
                        tool_paths(tool, &mut paths, 0);
                    }
                }
                paths.truncate(512);
            }
        }
    }
    (final_message, paths, changed)
}
fn roots(project: &str, home: Option<&Path>) -> Vec<PathBuf> {
    let mut roots = vec![PathBuf::from(crate::project_paths::normalize(project))];
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
        PathBuf::from(crate::project_paths::normalize(raw))
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

// Canonical identities avoid mismatches between absolute paths, ./paths and
// Markdown line anchors. checked_path also rejects symlinks outside allowed roots.
fn existing_path(project: &str, raw: &str) -> Option<PathBuf> {
    let (root, relative) = locate(project, raw, dirs::home_dir().as_deref()).ok()?;
    let path = crate::files::checked_path(&root, &relative).ok()?;
    path.is_file().then_some(path)
}
fn verified_paths<'a>(project: &str, paths: impl Iterator<Item = &'a String>) -> HashSet<PathBuf> {
    paths
        .filter_map(|path| existing_path(project, path))
        .collect()
}
type TimeWindow = (std::time::SystemTime, std::time::SystemTime);
fn time_window(start: &str, end: &str) -> Option<TimeWindow> {
    let start = chrono::DateTime::parse_from_rfc3339(start).ok()?.into();
    let end = chrono::DateTime::parse_from_rfc3339(end).ok()?.into();
    (start <= end).then_some((start, end))
}
fn produced(project: &str, raw: &str, written: &HashSet<PathBuf>, windows: &[TimeWindow]) -> bool {
    let Some(path) = existing_path(project, raw) else {
        return false;
    };
    if written.contains(&path) {
        return true;
    }
    // Shell-generated documents have no structured write event. Only explicitly
    // published files with an mtime inside the execution window qualify. A prose
    // reference alone never establishes a deliverable, nor does global git status.
    !windows.is_empty()
        && fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .is_some_and(|modified| {
                windows
                    .iter()
                    .any(|(start, end)| modified >= *start && modified <= *end)
            })
}

pub(super) fn collect(state: &AppState, run: &Run, indices: &[usize]) -> ArtifactList {
    collect_at(state, run, indices, false)
}
fn collect_at(
    state: &AppState,
    run: &Run,
    indices: &[usize],
    include_evidence: bool,
) -> ArtifactList {
    let completed: Vec<_> = indices
        .iter()
        .copied()
        .filter(|&i| run.definition.steps[i].kind == "agent" && run.steps[i].status == "completed")
        .collect();
    // Legacy runs have no publication section. Show the last completed producers
    // on each connected path, not every intermediate inspection node.
    let superseded: HashSet<_> = completed
        .iter()
        .flat_map(|&i| {
            if run.definition.edges.is_some() {
                graph::ancestors(run, i)
            } else {
                (0..i).collect()
            }
        })
        .collect();
    let sources: Vec<_> = indices
        .iter()
        .filter(|&&i| {
            run.definition.steps[i].kind == "agent"
                && !["pending", "skipped"].contains(&run.steps[i].status.as_str())
        })
        .map(|&index| (index, step_paths(state, run, index, include_evidence)))
        .collect();
    // Final nodes may publish an upstream node's output. Verify against all
    // producers, including successful writes before a pause or failure.
    let written = verified_paths(
        &run.project,
        sources.iter().flat_map(|(_, (_, _, writes))| writes.iter()),
    );
    let windows: Vec<_> = completed
        .iter()
        .filter_map(|&i| {
            time_window(
                run.steps[i].started_at.as_deref()?,
                run.steps[i].finished_at.as_deref()?,
            )
        })
        .collect();
    let mut candidates = Vec::new();
    let mut supporting = Vec::new();
    for (index, (final_message, evidence, writes)) in sources.into_iter().rev() {
        let declared = declared_paths(&final_message);
        let explicit = declared.is_some();
        let published = declared.unwrap_or_else(|| {
            let mut paths = Vec::new();
            if !superseded.contains(&index) {
                references(&final_message, &mut paths);
            }
            paths
        });
        candidates.extend(
            published
                .into_iter()
                .filter(|path| {
                    include_evidence
                        || produced(
                            &run.project,
                            path,
                            &written,
                            if explicit { &windows } else { &[] },
                        )
                })
                .map(|path| (index, path)),
        );
        supporting.extend(writes.into_iter().map(|path| (index, path)));
        if include_evidence {
            supporting.extend(evidence.into_iter().map(|path| (index, path)));
        }
    }
    // Final files receive the file-count and excerpt budgets first. Internal
    // references remain available to reviewers without cluttering the UI.
    candidates.extend(supporting);
    collect_candidates(
        &run.project,
        candidates
            .into_iter()
            .map(|(index, path)| (run.definition.steps[index].id.clone(), path)),
        include_evidence,
    )
}
fn collect_candidates(
    project_root: &str,
    candidates: impl IntoIterator<Item = (String, String)>,
    include_errors: bool,
) -> ArtifactList {
    let home = dirs::home_dir();
    let mut result = ArtifactList {
        files: Vec::new(),
        truncated: false,
    };
    let mut seen = HashSet::new();
    for (source_id, raw) in candidates {
        let located = locate(project_root, &raw, home.as_deref());
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
                let id = &source_id;
                if !file.step_ids.contains(id) {
                    file.step_ids.push(id.clone());
                }
            }
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
        if !include_errors && error.is_some() {
            continue;
        }
        if result.files.len()
            >= if include_errors {
                MAX_FILES
            } else {
                MAX_LIST_FILES
            }
        {
            result.truncated = true;
            continue;
        }
        result.files.push(Artifact {
            path,
            project,
            relative_path,
            step_ids: vec![source_id],
            size,
            error,
        });
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
    let list = collect_at(state, run, &completed, true);
    let mut budget = limit;
    let files: Vec<_> = list
        .files
        .iter()
        .enumerate()
        .map(|(index, file)| {
            let mut value =
                serde_json::json!({"path":file.path,"stepIds":file.step_ids,"size":file.size});
            if budget == 0 {
                value["error"] = "证据总量达到上限，未读取正文".into();
            } else {
                match read(file, FILE_BYTES.min(budget / (list.files.len() - index))) {
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
    let incomplete = list.truncated
        || files
            .iter()
            .any(|f| f["truncated"] == true || f.get("error").is_some());
    serde_json::json!({"files":files,"truncated":incomplete})
}
// Reuse the validated artifact catalog; never turn arbitrary transcript paths into reads.
pub(crate) fn supervision_evidence(state: &AppState, task: &Task) -> serde_json::Value {
    let path = state
        .dir
        .join("logs")
        .join(format!("{}.messages.jsonl", task.id));
    let summary = state.artifact_logs.lock().unwrap().read(&path);
    let Ok(summary) = summary else {
        return serde_json::json!({"files":[], "error":"产物记录不可读"});
    };
    let list = conversation_artifacts_with_writes(
        &TaskDetail {
            task: task.clone(),
            messages: summary.messages,
            log: String::new(),
            revision: String::new(),
        },
        summary.written,
    );
    let mut budget = 64 * 1024;
    let files: Vec<_> = list
        .files
        .iter()
        .take(8)
        .map(|file| {
            let mut value = serde_json::json!({"path":file.path,"size":file.size});
            match read(file, (8 * 1024).min(budget)) {
                Ok(preview) => {
                    budget = budget.saturating_sub(preview.content.len());
                    value["content"] = preview.content.into();
                    value["truncated"] = preview.truncated.into();
                }
                Err(error) => value["error"] = error.into(),
            }
            value
        })
        .collect();
    serde_json::json!({"files":files,"truncated":list.truncated || list.files.len()>8})
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

fn conversation_artifacts(detail: &TaskDetail) -> ArtifactList {
    conversation_artifacts_with_writes(detail, writes::successful_paths(&detail.messages))
}
fn conversation_artifacts_with_writes(detail: &TaskDetail, changed: Vec<String>) -> ArtifactList {
    let written = verified_paths(&detail.task.project, changed.iter());
    let windows: Vec<_> = time_window(&detail.task.created_at, &detail.task.updated_at)
        .into_iter()
        .collect();
    let mut paths = Vec::new();
    for message in detail
        .messages
        .iter()
        .rev()
        .filter(|m| m.role == "assistant" && m.tool.is_none())
        .take(100)
    {
        let declared = declared_paths(&message.text);
        let explicit = declared.is_some();
        let candidates = declared.unwrap_or_else(|| {
            let mut paths = Vec::new();
            references(&message.text, &mut paths);
            paths
        });
        paths.extend(candidates.into_iter().filter(|path| {
            produced(
                &detail.task.project,
                path,
                &written,
                if explicit { &windows } else { &[] },
            )
        }));
        if paths.len() >= 512 {
            break;
        }
    }
    paths.extend(changed);
    collect_candidates(
        &detail.task.project,
        paths.into_iter().map(|path| (detail.task.id.clone(), path)),
        false,
    )
}
async fn task_files(app: tauri::AppHandle, id: String) -> Result<ArtifactList, String> {
    let handle = app.clone();
    let task_id = id.clone();
    let local =
        tauri::async_runtime::spawn_blocking(move || -> Result<Option<ArtifactList>, String> {
            let state = handle.state::<AppState>();
            let db = state.db.lock().map_err(|e| e.to_string())?;
            if db.deleted_tasks.contains(&task_id) {
                return Err("记录已删除".into());
            }
            let task = db.tasks.iter().find(|t| t.id == task_id).cloned();
            drop(db);
            let Some(task) = task else {
                return Ok(None);
            };
            let path = state
                .dir
                .join("logs")
                .join(format!("{task_id}.messages.jsonl"));
            if !path.exists() {
                return Ok(None);
            }
            let summary = state
                .artifact_logs
                .lock()
                .map_err(|e| e.to_string())?
                .read(&path)
                .map_err(|e| e.to_string())?;
            Ok(Some(conversation_artifacts_with_writes(
                &TaskDetail {
                    revision: String::new(),
                    task,
                    messages: summary.messages,
                    log: String::new(),
                },
                summary.written,
            )))
        })
        .await
        .map_err(|e| e.to_string())??;
    if let Some(files) = local {
        return Ok(files);
    }
    // Imported native histories use their existing format-specific parser.
    tauri::async_runtime::spawn_blocking(move || {
        let detail = crate::detail_inner(&app, &id)?;
        Ok(conversation_artifacts(&detail))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn task_artifacts(app: tauri::AppHandle, id: String) -> Result<ArtifactList, String> {
    task_files(app, id).await
}
#[tauri::command]
pub async fn task_artifact(
    app: tauri::AppHandle,
    id: String,
    path: String,
) -> Result<Preview, String> {
    let list = task_files(app, id).await?;
    tauri::async_runtime::spawn_blocking(move || {
        let file = list
            .files
            .iter()
            .find(|file| file.path == path)
            .ok_or("产物不在此对话中")?;
        read(file, 256 * 1024)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conversation_deliverables_exclude_tool_inputs_and_validate_preview_paths() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("final.md"), "Final output").unwrap();
        fs::write(tmp.path().join("notes.md"), "Private working notes").unwrap();
        let task: Task = serde_json::from_value(serde_json::json!({"id":"task","title":"test","prompt":"hello","project":tmp.path().to_str().unwrap(),"agentId":"claude","agentKind":"claude","status":"completed","preview":"","createdAt":"","updatedAt":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"default","exitCode":null,"sessionId":null})).unwrap();
        let message = |text: &str, tool: Option<serde_json::Value>| Message {
            attachments: vec![],
            native_id: None,
            synthetic: None,
            agent_kind: None,
            role: "assistant".into(),
            text: text.into(),
            timestamp: String::new(),
            tool,
            parent_call_id: None,
            delta: false,
        };
        let mut detail = TaskDetail {
            revision: String::new(),
            task,
            log: String::new(),
            messages: vec![
                message(
                    "read notes.md",
                    Some(serde_json::json!({"path":"notes.md"})),
                ),
                message(
                    "Write",
                    Some(
                        serde_json::json!({"callId":"w", "name":"Write", "input":{"file_path":"final.md"}, "state":"called"}),
                    ),
                ),
                message(
                    "",
                    Some(serde_json::json!({"callId":"w", "state":"completed", "output":"ok"})),
                ),
                message(
                    "## 最终产物\n- `final.md`\n- `notes.md`\n- `missing.md`\n## 交接\n`notes.md`",
                    None,
                ),
            ],
        };
        let files = conversation_artifacts(&detail);
        assert_eq!(files.files.len(), 1);
        assert_eq!(files.files[0].relative_path, "final.md");
        assert_eq!(read(&files.files[0], 100).unwrap().content, "Final output");
        // A successful write is sufficient; no final-answer link is required.
        detail.messages.retain(|message| message.tool.is_some());
        fs::write(tmp.path().join("unmentioned.txt"), "edited").unwrap();
        detail.messages.push(message("Edit", Some(serde_json::json!({"name":"Edit", "state":"completed", "input":{"file_path":"unmentioned.txt","old_string":"old","new_string":"edited"}}))));
        detail.messages.push(message("## 最终产物\n无", None));
        let files = conversation_artifacts(&detail);
        assert_eq!(files.files.len(), 2);
        assert!(files
            .files
            .iter()
            .any(|file| file.relative_path == "unmentioned.txt"));
        fs::remove_file(tmp.path().join("final.md")).unwrap();
        let files = conversation_artifacts(&detail);
        assert_eq!(files.files.len(), 1);
        assert_eq!(files.files[0].relative_path, "unmentioned.txt");
    }
    #[test]
    fn only_existing_outputs_count_towards_the_display_limit() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("final.md"), "output").unwrap();
        let paths = (0..40)
            .map(|i| ("task".into(), format!("missing-{i}.md")))
            .chain(std::iter::once(("task".into(), "final.md".into())));
        let list = collect_candidates(tmp.path().to_str().unwrap(), paths, false);
        assert_eq!(list.files.len(), 1);
        assert!(!list.truncated);
        let paths: Vec<_> = (0..40)
            .map(|i| {
                let name = format!("created-{i}.txt");
                fs::write(tmp.path().join(&name), "output").unwrap();
                ("step".into(), name)
            })
            .collect();
        assert_eq!(
            collect_candidates(tmp.path().to_str().unwrap(), paths.clone(), false)
                .files
                .len(),
            40
        );
        assert_eq!(
            collect_candidates(tmp.path().to_str().unwrap(), paths, true)
                .files
                .len(),
            MAX_FILES
        );
        assert_eq!(list.files[0].relative_path, "final.md");
    }

    #[test]
    fn shell_outputs_require_a_publication_and_modification_during_execution() {
        use std::time::{Duration, SystemTime};
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_str().unwrap();
        let start = SystemTime::now();
        for name in ["old.md", "new.md", "later.md"] {
            fs::write(tmp.path().join(name), "content").unwrap();
        }
        let set_time = |name: &str, time| {
            fs::File::options()
                .write(true)
                .open(tmp.path().join(name))
                .unwrap()
                .set_times(fs::FileTimes::new().set_modified(time))
                .unwrap()
        };
        set_time("old.md", start - Duration::from_secs(60));
        set_time("new.md", start + Duration::from_secs(1));
        set_time("later.md", start + Duration::from_secs(60));
        let windows = [(start, start + Duration::from_secs(10))];
        let written = HashSet::new();
        assert!(produced(root, "new.md", &written, &windows));
        assert!(!produced(root, "new.md", &written, &[]));
        for name in ["old.md", "later.md", "missing.md", "../escape.md"] {
            assert!(!produced(root, name, &written, &windows), "{name}");
        }
        // A confirmed write remains an output even after the execution window.
        let written = verified_paths(root, ["later.md".to_owned()].iter());
        assert!(produced(root, "./later.md:12:3", &written, &[]));
    }

    #[test]
    fn publication_section_excludes_handoff_and_preserves_empty_declarations() {
        let text = "阅读了 `source.md`\n## 最终产物\n- [报告](<output/final report.md>)\n- `Dockerfile`\n## 交接\n参考 `plans/draft.md`，日志 `checks.log`";
        assert_eq!(
            declared_paths(text).unwrap(),
            vec!["output/final report.md", "Dockerfile"]
        );
        assert_eq!(
            declared_paths("## 最终产物\n无\n## 交接\n`plan.md`"),
            Some(vec![])
        );
        assert_eq!(
            declared_paths("```md\n## 最终产物\n`example.md`\n```"),
            None
        );
        assert_eq!(
            declared_paths("## Final deliverables\n- result.md"),
            Some(vec!["result.md".into()])
        );
    }
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
        assert!(!paths.contains(&"v2.md".into()));
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
