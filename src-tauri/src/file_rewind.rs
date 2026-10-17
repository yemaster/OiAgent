//! Native checkpoint control only. Never infer a checkpoint from prompt text or use git reset.
use crate::{
    models::{Agent, Message, Task},
    store::AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub files: Vec<String>,
    pub token: String,
}
struct Control {
    child: Child,
    writer: ChildStdin,
    receiver: mpsc::Receiver<Value>,
    kind: String,
    _auth: Option<tempfile::NamedTempFile>,
    _settings: Option<tempfile::NamedTempFile>,
}
impl Drop for Control {
    fn drop(&mut self) {
        crate::process::terminate_background(&mut self.child);
        let _ = self.child.wait();
    }
}
impl Control {
    fn open(state: &AppState, task: &Task, agent: &Agent) -> Result<Self, String> {
        let executable = crate::discovery::resolve(&agent.executable).ok_or("找不到 Agent 程序")?;
        let mut command = crate::process::agent_command(executable)?;
        command.args([
            "-p",
            "--input-format",
            "stream-json",
            "--output-format",
            "stream-json",
            "--resume",
            task.session_id.as_deref().ok_or("没有原生会话")?,
        ]);
        let mut settings_args = vec![];
        let settings = crate::launch_settings::prepare(
            &agent.kind,
            &task.project,
            &mut settings_args,
            Some(if agent.kind == "claude" {
                json!({"disableAllHooks":true})
            } else {
                crate::launch_settings::checkpoint_settings()
            }),
        )?;
        command.args(settings_args);
        if agent.kind == "claude" {
            command
                .arg("--verbose")
                .env("CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING", "true");
        }
        let env = crate::launch::environment(state, task)?;
        command
            .current_dir(&task.project)
            .env("PATH", crate::discovery::path_env())
            .envs(&env)
            .envs(crate::providers::environment(state, task)?)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let auth = if agent.kind == "qodercn" {
            Some(crate::qodercn::prepare_sdk(&mut command, &env)?)
        } else {
            None
        };
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let mut child = command.spawn().map_err(|e| e.to_string())?;
        let writer = child.stdin.take().ok_or("无法打开 Agent 输入")?;
        let out = child.stdout.take().ok_or("无法读取 Agent 输出")?;
        let (sender, receiver) = mpsc::sync_channel(32);
        std::thread::spawn(move || {
            let mut reader = BufReader::new(out);
            loop {
                let mut line = String::new();
                // Bound an untrusted protocol line; a broken CLI must not exhaust memory.
                use std::io::Read;
                let n = reader.by_ref().take(2 * 1024 * 1024).read_line(&mut line);
                if !matches!(n, Ok(n) if n > 0) || !line.ends_with('\n') {
                    break;
                }
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if sender.send(value).is_err() {
                        break;
                    }
                }
            }
        });
        let mut control = Self {
            child,
            writer,
            receiver,
            kind: agent.kind.clone(),
            _auth: auth,
            _settings: settings,
        };
        let mut init = if agent.kind == "qodercn" {
            json!({"hooks": {}})
        } else {
            json!({"hooks": null})
        };
        init[control.discriminator()] = json!("initialize");
        control.request(init)?;
        Ok(control)
    }
    fn discriminator(&self) -> &'static str {
        if self.kind == "qodercn" {
            "type"
        } else {
            "subtype"
        }
    }
    fn request(&mut self, request: Value) -> Result<Value, String> {
        let id = uuid::Uuid::new_v4().to_string();
        writeln!(
            self.writer,
            "{}",
            json!({"type":"control_request","request_id":id,"request":request})
        )
        .and_then(|_| self.writer.flush())
        .map_err(|e| e.to_string())?;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            let message = self
                .receiver
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| "检查点操作未确认完成，已关闭连接")?;
            if message["type"] == "control_response" && message["response"]["request_id"] == id {
                let response = &message["response"];
                if response["subtype"] != "success" {
                    return Err(response["error"]
                        .as_str()
                        .unwrap_or("Agent 不支持此检查点操作")
                        .into());
                }
                return Ok(response["response"].clone());
            }
            if message["type"] == "control_request" {
                // No permission, tool execution, hook or elicitation is approved by a rewind connection.
                writeln!(self.writer, "{}", json!({"type":"control_response","response":{"subtype":"error","request_id":message["request_id"],"error":"Checkpoint-only connection"}})).map_err(|e| e.to_string())?;
                self.writer.flush().map_err(|e| e.to_string())?;
            }
        }
    }
    fn rewind(&mut self, anchor: &str, dry_run: bool) -> Result<Value, String> {
        let mut request = json!({"user_message_id":anchor,"dry_run":dry_run});
        request[self.discriminator()] = json!("rewind_files");
        let response = self.request(request)?;
        if response["canRewind"] != true || response["skippedLinks"].as_u64().unwrap_or(0) > 0 {
            return Err(response["error"]
                .as_str()
                .unwrap_or("检查点不可完整恢复")
                .into());
        }
        Ok(response)
    }
}
pub fn anchor<'a>(task: &Task, message: &'a Message, agent: &Agent) -> Result<&'a str, String> {
    if agent.custom || !matches!(agent.kind.as_str(), "claude" | "qodercn") {
        return Err("此 Agent 未提供可校验的文件检查点".into());
    }
    #[cfg(windows)]
    if agent.kind == "qodercn" {
        return Err("此版本暂不支持 Windows 上的 Qoder 文件恢复".into());
    }
    if agent.kind == "claude" {
        let version = agent
            .version
            .split(|c: char| !c.is_ascii_digit() && c != '.')
            .find_map(|v| semver::Version::parse(v).ok());
        if !version.is_some_and(|v| v >= semver::Version::new(2, 1, 216)) {
            return Err("文件恢复需要 Claude Code 2.1.216 或更新版本".into());
        }
    }
    if task.sessions.len() > 1
        || task.usage_by_agent.len() > 1
        || message
            .agent_kind
            .as_deref()
            .is_some_and(|k| k != task.agent_kind)
    {
        return Err("跨 Agent 会话无法确认文件检查点".into());
    }
    task.session_id.as_ref().ok_or("没有原生会话检查点")?;
    let anchor = message
        .native_id
        .as_deref()
        .ok_or("这条消息没有文件检查点")?;
    uuid::Uuid::parse_str(anchor).map_err(|_| "检查点标识无效")?;
    Ok(anchor)
}
fn safe_file(project: &Path, value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value);
    if !path.is_absolute() || !path.starts_with(project) {
        return Err("检查点包含项目外的文件".into());
    }
    let relative = path.strip_prefix(project).map_err(|e| e.to_string())?;
    let mut cursor = project.to_path_buf();
    for part in relative.components() {
        let std::path::Component::Normal(name) = part else {
            return Err("检查点路径不安全".into());
        };
        if name.to_string_lossy().eq_ignore_ascii_case(".git") {
            return Err("不能恢复 Git 内部文件".into());
        }
        cursor.push(name);
        match fs::symlink_metadata(&cursor) {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    return Err("检查点路径包含符号链接".into());
                }
                #[cfg(unix)]
                {
                    use std::os::unix::fs::MetadataExt;
                    if meta.is_file() && meta.nlink() > 1 {
                        return Err("检查点包含硬链接".into());
                    }
                }
                if meta.is_dir()
                    && !dunce::canonicalize(&cursor)
                        .map_err(|e| e.to_string())?
                        .starts_with(project)
                {
                    return Err("检查点父目录已指向项目外".into());
                }
                if cursor != path && !meta.is_dir() {
                    return Err("检查点父目录无效".into());
                }
                if cursor == path && (!meta.is_file() || meta.len() > 16 * 1024 * 1024) {
                    return Err("检查点文件类型或大小不支持恢复".into());
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && cursor == path => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    if cursor == project {
        return Err("检查点不是文件".into());
    }
    Ok(path)
}
fn preview(task: &Task, anchor: &str, value: &Value) -> Result<Preview, String> {
    let files = value["filesChanged"]
        .as_array()
        .ok_or("Agent 未返回完整文件列表")?;
    if files.len() > 200 {
        return Err("检查点文件超过 200 个，请在原生终端恢复".into());
    }
    let project = dunce::canonicalize(&task.project).map_err(|e| e.to_string())?;
    let mut files = files
        .iter()
        .map(|file| {
            file.as_str()
                .map(String::from)
                .ok_or("检查点文件路径无效".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    files.sort();
    files.dedup();
    let mut hash = Sha256::new();
    hash.update(
        serde_json::to_vec(&(task.session_id.as_ref(), anchor, &files))
            .map_err(|e| e.to_string())?,
    );
    for file in &files {
        let path = safe_file(&project, file)?;
        match fs::read(path) {
            Ok(bytes) => {
                hash.update([1]);
                hash.update(Sha256::digest(bytes));
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => hash.update([0]),
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(Preview {
        files,
        token: format!("{:x}", hash.finalize()),
    })
}
pub fn inspect(
    state: &AppState,
    task: &Task,
    message: &Message,
    agent: &Agent,
) -> Result<Preview, String> {
    let anchor = anchor(task, message, agent)?;
    let value = Control::open(state, task, agent)?.rewind(anchor, true)?;
    preview(task, anchor, &value)
}
pub fn apply(
    state: &AppState,
    task: &Task,
    message: &Message,
    agent: &Agent,
    expected: &str,
    operation: &str,
) -> Result<(), String> {
    let anchor = anchor(task, message, agent)?;
    let mut control = Control::open(state, task, agent)?;
    let native = control.rewind(anchor, true)?;
    let current = preview(task, anchor, &native)?;
    if current.token != expected {
        return Err("文件已发生变化，请重新预览恢复范围".into());
    }
    let backup = state.dir.join("rewind-backups").join(operation);
    fs::create_dir_all(backup.parent().unwrap()).map_err(|e| e.to_string())?;
    fs::create_dir(&backup)
        .map_err(|_| "此恢复操作已执行或未确认完成，请先检查文件；不会重复恢复")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&backup, fs::Permissions::from_mode(0o700))
            .map_err(|e| e.to_string())?;
    }
    for (i, file) in current.files.iter().enumerate() {
        match fs::read(file) {
            Ok(bytes) => {
                let mut f =
                    fs::File::create(backup.join(i.to_string())).map_err(|e| e.to_string())?;
                f.write_all(&bytes)
                    .and_then(|_| f.sync_all())
                    .map_err(|e| e.to_string())?;
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
    }
    fs::write(backup.join("manifest.json"), serde_json::to_vec(&json!({"session": task.session_id,"checkpoint":anchor,"files":current.files,"status":"prepared"})).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    // Recheck after backup I/O. Never apply a preview that has become stale.
    if preview(task, anchor, &native)?.token != expected {
        return Err("备份期间文件已变化，未执行恢复".into());
    }
    let result = control.rewind(anchor, false);
    fs::write(
        backup.join("result.json"),
        json!({"success": result.is_ok(), "error": result.as_ref().err()}).to_string(),
    )
    .map_err(|e| e.to_string())?;
    result
        .map(|_| ())
        .map_err(|error| format!("{error}。任务未启动，恢复前备份：{}", backup.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn task(project: &Path) -> Task {
        serde_json::from_value(json!({"id":"task","title":"task","prompt":"p","project":project.to_string_lossy(),"agentId":"claude","agentKind":"claude","status":"completed","createdAt":"t","updatedAt":"t","preview":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"default","sessionId":"native-session","exitCode":0})).unwrap()
    }
    #[test]
    fn preview_is_bound_to_session_checkpoint_file_contents_and_existence() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let file = root.join("test.txt");
        fs::write(&file, "first").unwrap();
        let task = task(&root);
        let value = json!({"filesChanged":[file]});
        let first = preview(&task, "anchor", &value).unwrap();
        fs::write(&file, "second").unwrap();
        assert_ne!(preview(&task, "anchor", &value).unwrap().token, first.token);
        assert_ne!(preview(&task, "other", &value).unwrap().token, first.token);
        fs::remove_file(&file).unwrap();
        assert_ne!(preview(&task, "anchor", &value).unwrap().token, first.token);
        assert!(preview(&task, "anchor", &json!({})).is_err());
        assert!(safe_file(&root, root.join("../escape").to_str().unwrap()).is_err());
        assert!(safe_file(&root, root.join(".git/config").to_str().unwrap()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlinks_parent_symlinks_and_hardlinks() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::write(root.join("file"), "data").unwrap();
        symlink(root.join("file"), root.join("link")).unwrap();
        assert!(safe_file(&root, root.join("link").to_str().unwrap()).is_err());
        symlink(&root, root.join("parent")).unwrap();
        assert!(safe_file(&root, root.join("parent/file").to_str().unwrap()).is_err());
        fs::hard_link(root.join("file"), root.join("hard")).unwrap();
        assert!(safe_file(&root, root.join("hard").to_str().unwrap()).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn native_control_previews_backs_up_and_rewinds_once_without_sending_a_prompt() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let file = root.join("document.txt");
        fs::write(&file, "edited").unwrap();
        let script = root.join("agent.py");
        fs::write(&script,format!(r#"#!/usr/bin/env python3
import json,sys,pathlib
path=pathlib.Path({path})
for line in sys.stdin:
 data=json.loads(line)
 assert data['type']=='control_request'
 request=data['request']
 if request.get('subtype',request.get('type'))=='initialize': value={{}}
 else:
  assert request.get('subtype',request.get('type'))=='rewind_files'
  assert request['user_message_id']=='00000000-0000-4000-8000-000000000001'
  if not request['dry_run']: path.write_text('original')
  value={{'canRewind':True,'filesChanged':[str(path)]}}
 print(json.dumps({{'type':'control_response','response':{{'subtype':'success','request_id':data['request_id'],'response':value}}}}),flush=True)
"#,path=serde_json::to_string(file.to_str().unwrap()).unwrap())).unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o700)).unwrap();
        let state = AppState::load(root.join("app")).unwrap();
        let mut task = task(&root);
        let mut agent = Agent {
            id: "claude".into(),
            name: "fixture".into(),
            kind: "claude".into(),
            executable: script.to_string_lossy().into(),
            args: vec![],
            available: true,
            version: "2.1.216 (Claude Code)".into(),
            custom: false,
        };
        let message:Message=serde_json::from_value(json!({"role":"user","text":"prompt","timestamp":"t","nativeId":"00000000-0000-4000-8000-000000000001"})).unwrap();
        for kind in ["claude", "qodercn"] {
            agent.kind = kind.into();
            task.agent_kind = kind.into();
            fs::write(&file, "edited").unwrap();
            let prepared = inspect(&state, &task, &message, &agent).unwrap();
            assert_eq!(fs::read_to_string(&file).unwrap(), "edited");
            fs::write(&file, "manual edit").unwrap();
            assert!(apply(&state, &task, &message, &agent, &prepared.token, "stale").is_err());
            assert_eq!(fs::read_to_string(&file).unwrap(), "manual edit");
            fs::write(&file, "edited").unwrap();
            apply(&state, &task, &message, &agent, &prepared.token, kind).unwrap();
            assert_eq!(fs::read_to_string(&file).unwrap(), "original");
            assert_eq!(
                fs::read_to_string(state.dir.join("rewind-backups").join(kind).join("0")).unwrap(),
                "edited"
            );
            fs::write(&file, "edited").unwrap();
            assert!(apply(&state, &task, &message, &agent, &prepared.token, kind).is_err());
            assert_eq!(fs::read_to_string(&file).unwrap(), "edited");
        }
    }
}
