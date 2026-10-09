use crate::models::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    fs::File,
    io::{BufRead, BufReader, BufWriter, Write},
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

pub fn string(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}
fn num(v: &Value, key: &str) -> u64 {
    v.get(key).and_then(Value::as_u64).unwrap_or(0)
}
pub fn text_content(v: &Value) -> String {
    if let Some(s) = v.as_str() {
        return s.to_owned();
    }
    if let Some(parts) = v.as_array() {
        return parts
            .iter()
            .filter(|p| p["thought"] != true)
            .filter_map(|p| p.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}
pub fn usage(v: &Value) -> Usage {
    let input = num(v, "input_tokens")
        + num(v, "cache_read_input_tokens")
        + num(v, "cache_creation_input_tokens");
    Usage {
        input,
        output: num(v, "output_tokens"),
        cached: num(v, "cached_input_tokens").max(num(v, "cache_read_input_tokens")),
        known: v.is_object(),
    }
}
pub fn short(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}
fn user_title(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty()
        || t.starts_with("<")
        || t.starts_with("# AGENTS.md")
        || t.starts_with("[Request interrupted")
    {
        None
    } else {
        Some(short(t.lines().next().unwrap_or(t), 90))
    }
}

#[derive(Serialize, Deserialize)]
struct Parser {
    task: Task,
    #[serde(skip)]
    messages: Vec<Message>,
    seen: HashSet<String>,
    claude_usage: HashMap<String, Usage>,
    subagent_file: bool,
}
impl Parser {
    fn new(path: &Path, kind: &str) -> Self {
        let stamp = path
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339())
            .unwrap_or_else(now);
        let task = Task {
            context_handoff: false,
            provider_id: None,
            sessions: vec![],
            usage_by_agent: Default::default(),
            extra_args: vec![],
            env_keys: vec![],
            queued_messages: vec![],
            active_prompt: None,
            terminal_id: None,
            id: String::new(),
            title: String::new(),
            prompt: String::new(),
            project: String::new(),
            agent_id: kind.into(),
            agent_kind: kind.into(),
            status: "imported".into(),
            created_at: String::new(),
            updated_at: stamp,
            preview: String::new(),
            usage: Usage::default(),
            session_usage: None,
            session_id: None,
            source: "history".into(),
            model: String::new(),
            permission: "read-only".into(),
            exit_code: None,
            parent_id: None,
            subagent_id: None,
            subagent_name: None,
            archived: false,
            history_path: Some(path.to_string_lossy().into()),
        };
        Self {
            task,
            messages: vec![],
            seen: HashSet::new(),
            claude_usage: HashMap::new(),
            subagent_file: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .starts_with("agent-")
                || path.components().any(|c| c.as_os_str() == "subagents"),
        }
    }
    fn ingest(&mut self, v: &Value, detail: bool) {
        let kind = self.task.agent_kind.clone();
        let task = &mut self.task;
        let messages = &mut self.messages;
        let seen = &mut self.seen;
        let claude_usage = &mut self.claude_usage;
        if v["isSidechain"].as_bool() == Some(true) && !self.subagent_file {
            return;
        }
        let typ = string(&v, "type");
        let p = &v["payload"];
        let ts = string(&v, "timestamp");
        if !ts.is_empty() {
            if task.created_at.is_empty() {
                task.created_at = ts.clone();
            }
            task.updated_at = ts.clone();
        }
        let cwd = string(&v, "cwd");
        if !cwd.is_empty() {
            task.project = cwd;
        }
        let sid = string(&v, "sessionId");
        if !sid.is_empty() {
            task.session_id = Some(sid);
        }
        let model = string(&v, "model");
        if !model.is_empty() {
            task.model = model;
        }
        let mut role = String::new();
        let mut text = String::new();
        if kind == "codex" {
            if typ == "session_meta" {
                task.project = string(p, "cwd");
                task.session_id = Some(string(p, "id"));
                let spawn = &p["source"]["subagent"]["thread_spawn"];
                if let Some(parent) = spawn["parent_thread_id"]
                    .as_str()
                    .or(p["parent_thread_id"].as_str())
                {
                    task.parent_id = Some(format!("history-codex-{parent}"));
                    task.subagent_id = task.session_id.clone();
                    task.source = "subagent".into();
                    task.subagent_name = spawn["agent_nickname"]
                        .as_str()
                        .or(spawn["agent_role"].as_str())
                        .map(String::from);
                }
            }
            if typ == "turn_context" {
                task.model = string(p, "model");
            }
            if typ == "response_item" && p["type"] == "message" {
                role = string(p, "role");
                text = text_content(&p["content"]);
            }
            if typ == "event_msg"
                && p["type"] == "token_count"
                && p["info"]["total_token_usage"].is_object()
            {
                task.usage = usage(&p["info"]["total_token_usage"]);
            }
            if typ == "token_usage_record" && p["thread_token_usage"].is_object() {
                task.usage = usage(&p["thread_token_usage"]);
            }
        } else {
            if typ == "user" || typ == "assistant" {
                role = typ.clone();
                text = text_content(
                    v["message"]
                        .get("content")
                        .unwrap_or(&v["message"]["parts"]),
                );
            }
            if typ == "assistant" && kind == "claude" {
                let u = &v["message"]["usage"];
                if u.is_object() {
                    let key = v["message"]["id"]
                        .as_str()
                        .or(v["uuid"].as_str())
                        .unwrap_or(&ts)
                        .to_string();
                    let entry = claude_usage.entry(key).or_default();
                    let next = usage(u);
                    entry.input = entry.input.max(next.input);
                    entry.output = entry.output.max(next.output);
                    entry.cached = entry.cached.max(next.cached);
                    entry.known = true;
                }
                let m = string(&v["message"], "model");
                if !m.is_empty() {
                    task.model = m;
                }
            }
            if typ == "assistant" && kind == "qwen" && v["usageMetadata"].is_object() {
                let key = string(&v, "uuid");
                if key.is_empty() || seen.insert(key) {
                    let u = &v["usageMetadata"];
                    task.usage.add(&Usage {
                        input: num(u, "promptTokenCount"),
                        output: num(u, "candidatesTokenCount") + num(u, "thoughtsTokenCount"),
                        cached: num(u, "cachedContentTokenCount"),
                        known: true,
                    });
                }
            }
        }
        if self.subagent_file && kind != "codex" {
            let agent_id = string(v, "agentId");
            if !agent_id.is_empty() {
                task.subagent_id = Some(agent_id);
            }
            if task.subagent_id.is_none() {
                task.subagent_id = task
                    .history_path
                    .as_ref()
                    .and_then(|p| Path::new(p).file_stem())
                    .map(|s| s.to_string_lossy().trim_start_matches("agent-").to_string());
            }
            task.source = "subagent".into();
            if let Some(sid) = &task.session_id {
                task.parent_id = Some(format!("history-{kind}-{sid}"));
            }
            let name = string(v, "agentName");
            if !name.is_empty() {
                task.subagent_name = Some(name);
            }
        }
        if detail {
            messages.extend(crate::transcript::messages(v, &ts));
        }
        if role == "user" && task.title.is_empty() {
            if let Some(title) = user_title(&text) {
                task.title = title;
                task.prompt = short(&text, 20000);
            }
        }
        if (role == "assistant" || role == "user") && !text.trim().is_empty() {
            if role == "assistant" {
                task.preview = short(&text, 240);
            }
        }
    }
    fn task(&self) -> Result<Task, String> {
        let mut task = self.task.clone();
        let kind = task.agent_kind.clone();
        if kind == "claude" {
            task.usage = Usage::default();
            for u in self.claude_usage.values() {
                task.usage.add(u);
            }
        }
        if task.project.is_empty() || task.session_id.as_deref().unwrap_or_default().is_empty() {
            return Err("缺少会话目录或 ID".into());
        }
        task.id = format!(
            "history-{}-{}",
            kind,
            task.session_id.as_deref().unwrap_or_default()
        );
        if kind != "codex" {
            if let Some(agent) = &task.subagent_id {
                task.id = format!("{}-subagent-{agent}", task.id);
            }
        }
        if task.title.is_empty() {
            task.title = task
                .subagent_name
                .clone()
                .unwrap_or_else(|| "未命名会话".into());
        }
        if task.preview.is_empty() {
            task.preview = short(&task.prompt, 240);
        }
        if task.created_at.is_empty() {
            task.created_at = task.updated_at.clone();
        }
        Ok(task)
    }
}
pub fn parse_file(path: &Path, kind: &str, detail: bool) -> Result<(Task, Vec<Message>), String> {
    let mut parser = Parser::new(path, kind);
    let file = File::open(path).map_err(|e| e.to_string())?;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if let Ok(v) = serde_json::from_str::<Value>(&line) {
            parser.ingest(&v, detail);
        }
    }
    Ok((parser.task()?, parser.messages))
}
#[derive(Serialize, Deserialize)]
struct CacheEntry {
    len: u64,
    time: std::time::SystemTime,
    identity: u64,
    offset: u64,
    parser: Parser,
}
fn file_identity(meta: &std::fs::Metadata) -> u64 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        meta.ino()
    }
    #[cfg(not(unix))]
    {
        meta.created()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }
}
impl CacheEntry {
    fn read(path: &Path, kind: &str, previous: Option<Self>) -> Result<Self, String> {
        use std::io::{Seek, SeekFrom};
        let meta = path.metadata().map_err(|e| e.to_string())?;
        let time = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
        let identity = file_identity(&meta);
        let mut entry = match previous {
            Some(e)
                if e.identity == identity
                    && (meta.len() > e.len || (meta.len() == e.len && time == e.time)) =>
            {
                e
            }
            _ => Self {
                len: 0,
                time,
                identity,
                offset: 0,
                parser: Parser::new(path, kind),
            },
        };
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        file.seek(SeekFrom::Start(entry.offset))
            .map_err(|e| e.to_string())?;
        let mut reader = BufReader::new(file);
        let mut line = String::new();
        loop {
            line.clear();
            let n = reader.read_line(&mut line).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            match serde_json::from_str::<Value>(&line) {
                Ok(v) => entry.parser.ingest(&v, false),
                Err(_) if !line.ends_with('\n') => break,
                Err(_) => {}
            }
            entry.offset += n as u64;
        }
        entry.len = meta.len();
        entry.time = time;
        Ok(entry)
    }
}

// Version the parser state so future parsing changes can safely invalidate this index.
const INDEX_VERSION: u32 = 1;
#[derive(Serialize, Deserialize)]
struct DiskIndex {
    version: u32,
    roots: Vec<(String, PathBuf)>,
    entries: HashMap<PathBuf, CacheEntry>,
}
#[derive(Serialize)]
struct DiskIndexRef<'a> {
    version: u32,
    roots: &'a [(String, PathBuf)],
    entries: &'a HashMap<PathBuf, CacheEntry>,
}
fn history_roots() -> Vec<(String, PathBuf)> {
    let home = dirs::home_dir().unwrap_or_default();
    let codex = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    let claude = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"));
    [
        ("codex", codex.join("sessions")),
        ("codex", codex.join("archived_sessions")),
        ("claude", claude.join("projects")),
        ("qwen", home.join(".qwen/projects")),
    ]
    .into_iter()
    .map(|(kind, path)| (kind.to_owned(), path))
    .collect()
}
pub struct HistoryCache {
    entries: HashMap<PathBuf, CacheEntry>,
    cache_path: Option<PathBuf>,
    loaded_roots: Option<Vec<(String, PathBuf)>>,
    dirty: bool,
}
impl HistoryCache {
    pub fn new() -> Self {
        Self {
            entries: HashMap::new(),
            cache_path: None,
            loaded_roots: None,
            dirty: false,
        }
    }
    pub fn with_disk_cache(path: PathBuf) -> Self {
        Self {
            cache_path: Some(path),
            ..Self::new()
        }
    }
    fn load_index(&mut self, roots: &[(String, PathBuf)]) {
        if self.loaded_roots.as_deref() == Some(roots) {
            return;
        }
        self.entries.clear();
        self.loaded_roots = Some(roots.to_vec());
        self.dirty = false;
        let index = self
            .cache_path
            .as_ref()
            .and_then(|p| File::open(p).ok())
            .and_then(|f| serde_json::from_reader::<_, DiskIndex>(BufReader::new(f)).ok());
        if let Some(index) = index.filter(|i| i.version == INDEX_VERSION && i.roots == roots) {
            self.entries = index.entries;
            self.entries.retain(|path, entry| {
                entry.offset <= entry.len
                    && roots.iter().any(|(kind, root)| {
                        path.starts_with(root) && entry.parser.task.agent_kind == *kind
                    })
            });
        }
    }
    fn save_index(&mut self, roots: &[(String, PathBuf)]) -> Result<(), String> {
        let Some(path) = &self.cache_path else {
            return Ok(());
        };
        if !self.dirty {
            return Ok(());
        }
        let parent = path.parent().ok_or("历史索引路径无效")?;
        let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        {
            let mut writer = BufWriter::new(tmp.as_file_mut());
            serde_json::to_writer(
                &mut writer,
                &DiskIndexRef {
                    version: INDEX_VERSION,
                    roots,
                    entries: &self.entries,
                },
            )
            .map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
        }
        tmp.persist(path).map_err(|e| e.to_string())?;
        self.dirty = false;
        Ok(())
    }
    fn summaries(&self) -> Vec<Task> {
        let tasks: HashMap<_, _> = self
            .entries
            .values()
            .filter_map(|e| e.parser.task().ok())
            .map(|t| (t.id.clone(), t))
            .collect();
        let mut tasks: Vec<_> = tasks.into_values().collect();
        tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        tasks
    }
    pub fn cached(&mut self) -> Vec<Task> {
        self.load_index(&history_roots());
        self.summaries()
    }
    pub fn find_session(&self, kind: &str, id: &str) -> Option<Task> {
        self.entries
            .values()
            .filter_map(|entry| entry.parser.task().ok())
            .find(|t| {
                t.subagent_id.is_none()
                    && t.agent_kind == kind
                    && t.session_id.as_deref() == Some(id)
            })
    }
    pub fn scan(&mut self) -> (Vec<Task>, Vec<String>) {
        self.scan_roots(&history_roots())
    }
    fn scan_roots(&mut self, roots: &[(String, PathBuf)]) -> (Vec<Task>, Vec<String>) {
        self.load_index(roots);
        let mut tasks = HashMap::new();
        let mut warnings = Vec::new();
        let mut visited = HashSet::new();
        for (kind, root) in roots {
            if !root.exists() {
                continue;
            }
            for entry in WalkDir::new(&root)
                .follow_links(false)
                .max_depth(8)
                .into_iter()
            {
                let entry = match entry {
                    Ok(e) => e,
                    Err(e) => {
                        warnings.push(e.to_string());
                        continue;
                    }
                };
                let p = entry.path();
                if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                    continue;
                }
                visited.insert(p.to_path_buf());
                let Ok(meta) = p.metadata() else { continue };
                let mt = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                if let Some(entry) = self.entries.get(p) {
                    if entry.len == meta.len()
                        && entry.time == mt
                        && entry.identity == file_identity(&meta)
                    {
                        if let Ok(task) = entry.parser.task() {
                            tasks.insert(task.id.clone(), task);
                        }
                        continue;
                    }
                }
                self.dirty = true;
                let previous = self.entries.remove(p);
                match CacheEntry::read(p, kind, previous) {
                    Ok(entry) => {
                        if let Ok(task) = entry.parser.task() {
                            tasks.insert(task.id.clone(), task);
                        }
                        self.entries.insert(p.to_path_buf(), entry);
                    }
                    Err(e) => warnings.push(format!("{}: {e}", p.display())),
                }
            }
        }
        let previous_count = self.entries.len();
        self.entries.retain(|p, _| visited.contains(p));
        self.dirty |= previous_count != self.entries.len();
        if let Err(error) = self.save_index(roots) {
            warnings.push(format!("历史索引保存失败：{error}"));
        }
        let mut tasks: Vec<_> = tasks.into_values().collect();
        tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        (tasks, warnings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn parse(data: &str, kind: &str) -> Task {
        let path = std::env::temp_dir().join(format!("oiagent-{}.jsonl", uuid::Uuid::new_v4()));
        std::fs::write(&path, data).unwrap();
        let task = parse_file(&path, kind, true).unwrap().0;
        std::fs::remove_file(path).unwrap();
        task
    }
    #[test]
    fn disk_index_reuses_parsing_state_and_tracks_appends_rewrites_and_deletes() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("sessions");
        std::fs::create_dir(&root).unwrap();
        let path = root.join("session.jsonl");
        let index = dir.path().join("index.json");
        let roots = vec![("claude".to_owned(), root)];
        let message = |output| {
            serde_json::json!({
                "type": "assistant", "sessionId": "session", "cwd": "/project",
                "message": {"id": "same-message", "content": [{"text": "ready"}],
                    "usage": {"input_tokens": 12, "output_tokens": output}}
            })
            .to_string()
        };
        std::fs::write(&path, format!("{}\n{{\"type\":", message(3))).unwrap();
        let mut cache = HistoryCache::with_disk_cache(index.clone());
        assert_eq!(cache.scan_roots(&roots).0[0].usage.output, 3);
        let offset = cache.entries[&path].offset;
        let saved_index = std::fs::metadata(&index).unwrap().modified().unwrap();
        drop(cache);

        let mut cache = HistoryCache::with_disk_cache(index.clone());
        cache.load_index(&roots);
        assert_eq!(cache.summaries()[0].usage.input, 12);
        assert_eq!(cache.entries[&path].offset, offset);
        assert!(cache.entries[&path].parser.messages.is_empty());
        cache.scan_roots(&roots);
        // An unchanged scan does not rewrite the cache.
        assert_eq!(
            std::fs::metadata(&index).unwrap().modified().unwrap(),
            saved_index
        );
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(f, "\"ignored\"}}").unwrap();
        writeln!(f, "{}", message(9)).unwrap();
        let tasks = cache.scan_roots(&roots).0;
        assert_eq!(tasks[0].usage.input, 12); // repeated message IDs must not double-count
        assert_eq!(tasks[0].usage.output, 9);
        assert!(cache.entries[&path].offset > offset);

        std::fs::write(&path, format!("{}\n", message(1))).unwrap();
        assert_eq!(cache.scan_roots(&roots).0[0].usage.output, 1);
        std::fs::remove_file(&path).unwrap();
        assert!(cache.scan_roots(&roots).0.is_empty());
        let mut cache = HistoryCache::with_disk_cache(index);
        cache.load_index(&roots);
        assert!(cache.summaries().is_empty());
    }
    #[test]
    fn invalid_disk_index_is_discarded_without_touching_history() {
        let dir = tempfile::tempdir().unwrap();
        let index = dir.path().join("index.json");
        let roots = vec![("codex".to_owned(), dir.path().join("sessions"))];
        for data in [
            "invalid json".to_owned(),
            serde_json::json!({
                "version": INDEX_VERSION + 1, "roots": roots, "entries": {}
            })
            .to_string(),
        ] {
            std::fs::write(&index, data).unwrap();
            let mut cache = HistoryCache::with_disk_cache(index.clone());
            cache.load_index(&roots);
            assert!(cache.summaries().is_empty());
            assert!(cache.scan_roots(&roots).1.is_empty());
        }
        let mut cache = HistoryCache::new();
        cache.loaded_roots = Some(vec![("codex".into(), PathBuf::from("/old/home"))]);
        cache.load_index(&roots);
        assert_eq!(cache.loaded_roots.as_ref(), Some(&roots));
    }
    #[test]
    fn incremental_cache_handles_partial_append_and_rewrite() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!(
            "oiagent-incremental-{}.jsonl",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(
            &path,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"s\",\"cwd\":\"/tmp\"}}\n{\"type\":",
        )
        .unwrap();
        let entry = CacheEntry::read(&path, "codex", None).unwrap();
        assert_eq!(
            entry.parser.task().unwrap().session_id.as_deref(),
            Some("s")
        );
        let offset = entry.offset;
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap();
        writeln!(file, "\"event_msg\",\"payload\":{{\"type\":\"token_count\",\"info\":{{\"total_token_usage\":{{\"input_tokens\":42,\"output_tokens\":8}}}}}}}}").unwrap();
        let entry = CacheEntry::read(&path, "codex", Some(entry)).unwrap();
        assert!(entry.offset > offset);
        assert_eq!(entry.parser.task().unwrap().usage.input, 42);
        std::fs::write(
            &path,
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"replacement\",\"cwd\":\"/tmp\"}}\n",
        )
        .unwrap();
        let entry = CacheEntry::read(&path, "codex", Some(entry)).unwrap();
        let task = entry.parser.task().unwrap();
        assert_eq!(task.session_id.as_deref(), Some("replacement"));
        assert!(!task.usage.known);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn codex_uses_cumulative_usage_and_skips_context() {
        let t = parse(
            r#"{"type":"session_meta","payload":{"id":"abc","cwd":"/tmp/a-b"}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"<environment_context>private</environment_context>"}]}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"修复搜索"}]}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":20}}}}
{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":150,"output_tokens":30}}}}
invalid partial line"#,
            "codex",
        );
        assert_eq!(t.title, "修复搜索");
        assert_eq!(t.project, "/tmp/a-b");
        assert_eq!(t.usage.input, 150);
        assert_eq!(t.status, "imported");
    }
    #[test]
    fn claude_deduplicates_streamed_message_usage() {
        let t = parse(
            r#"{"type":"assistant","sessionId":"s","cwd":"/tmp","message":{"id":"m","content":[{"text":"ok"}],"usage":{"input_tokens":10,"cache_read_input_tokens":30,"output_tokens":2}}}
{"type":"assistant","sessionId":"s","cwd":"/tmp","message":{"id":"m","content":[{"text":"ok"}],"usage":{"input_tokens":10,"cache_read_input_tokens":30,"output_tokens":5}}}"#,
            "claude",
        );
        assert_eq!(t.usage.input, 40);
        assert_eq!(t.usage.output, 5);
        assert_eq!(t.usage.cached, 30);
    }
    #[test]
    fn qwen_parts_and_thought_tokens() {
        let t = parse(
            r#"{"type":"user","sessionId":"s","cwd":"/tmp","message":{"parts":[{"text":"测试 Qwen"}]}}
{"type":"assistant","uuid":"1","usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":2,"cachedContentTokenCount":3},"message":{"parts":[{"text":"完成"}]}}"#,
            "qwen",
        );
        assert_eq!(t.title, "测试 Qwen");
        assert_eq!(t.usage.output, 7);
        assert_eq!(t.preview, "完成");
    }
    #[test]
    fn subagent_files_keep_parent_identity_and_independent_usage() {
        let root = std::env::temp_dir().join(format!("oiagent-child-{}", uuid::Uuid::new_v4()));
        let dir = root.join("parent-session").join("subagents");
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("agent-child1.jsonl");
        std::fs::write(&path, r#"{"type":"user","sessionId":"parent-session","agentId":"child1","isSidechain":true,"cwd":"/tmp","message":{"content":"Check files"}}
{"type":"assistant","sessionId":"parent-session","agentId":"child1","isSidechain":true,"message":{"id":"m","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":7,"output_tokens":3}}}"#).unwrap();
        let (task, messages) = parse_file(&path, "claude", true).unwrap();
        assert_eq!(task.id, "history-claude-parent-session-subagent-child1");
        assert_eq!(
            task.parent_id.as_deref(),
            Some("history-claude-parent-session")
        );
        assert_eq!(task.subagent_id.as_deref(), Some("child1"));
        assert_eq!(task.title, "Check files");
        assert_eq!(task.usage.input, 7);
        assert_eq!(messages.len(), 2);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn codex_thread_spawn_links_to_parent() {
        let task = parse(
            r#"{"type":"session_meta","payload":{"id":"child","cwd":"/tmp","source":{"subagent":{"thread_spawn":{"parent_thread_id":"parent","depth":1,"agent_nickname":"Researcher"}}}}}
{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Check API"}]}}"#,
            "codex",
        );
        assert_eq!(task.parent_id.as_deref(), Some("history-codex-parent"));
        assert_eq!(task.subagent_id.as_deref(), Some("child"));
        assert_eq!(task.subagent_name.as_deref(), Some("Researcher"));
    }
}
