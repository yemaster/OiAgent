//! Explicit native Codex compaction; never send a natural-language imitation.
use crate::{
    discovery,
    models::{now, Task},
    runtime,
    store::AppState,
};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Write},
    process::{Child, ChildStdin, Stdio},
    sync::{mpsc, Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;

struct Session {
    child: Arc<Mutex<Child>>,
    input: ChildStdin,
    output: mpsc::Receiver<String>,
    deadline: Instant,
}
impl Drop for Session {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            crate::process::terminate_background(&mut child);
            let _ = child.wait();
        }
    }
}
impl Session {
    fn send(&mut self, v: Value) -> Result<(), String> {
        writeln!(self.input, "{v}")
            .and_then(|_| self.input.flush())
            .map_err(|_| "压缩连接已关闭".into())
    }
    fn receive(&self) -> Result<Value, String> {
        loop {
            let line = self
                .output
                .recv_timeout(self.deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| "未确认上下文压缩完成，请检查会话状态后重试")?;
            if let Ok(v) = serde_json::from_str(&line) {
                return Ok(v);
            }
        }
    }
    fn rpc(&mut self, id: u32, method: &str, params: Value) -> Result<Value, String> {
        self.send(json!({"id":id,"method":method,"params":params}))?;
        loop {
            let v = self.receive()?;
            if v["id"] == id {
                if v.get("error").is_some() {
                    return Err(format!(
                        "Codex 拒绝 {method}：{}",
                        v["error"]["message"]
                            .as_str()
                            .unwrap_or("请检查 CLI 版本和登录状态")
                    ));
                }
                return Ok(v["result"].clone());
            }
            if v.get("id").is_some() && v.get("method").is_some() {
                self.send(json!({"id":v["id"],"error":{"code":-32601,"message":"Only context compaction is supported"}}))?;
            }
        }
    }
}
fn completed(v: &Value, sid: &str) -> bool {
    v["params"]["threadId"] == sid
        && (v["method"] == "thread/compacted"
            || (v["method"] == "item/completed"
                && v["params"]["item"]["type"] == "contextCompaction"))
}
fn record(state: &AppState, id: &str, call_id: &str, outcome: &str, error: Option<&str>) {
    let m = serde_json::from_value(json!({"role":"tool","text":"","timestamp":now(),"tool":{"callId":call_id,"name":"context_compaction","input":null,"output":{"outcome":outcome,"error":error},"state":if outcome == "running" {"running"} else if outcome == "failed" {"failed"} else {"completed"}}})).unwrap();
    runtime::append_record(state, id, &m);
}
#[tauri::command]
pub async fn compact_task(app: tauri::AppHandle, id: String) -> Result<Task, String> {
    tauri::async_runtime::spawn_blocking(move || compact(&app, &id))
        .await
        .map_err(|e| e.to_string())?
}
fn compact<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) -> Result<Task, String> {
    let state = app.state::<AppState>();
    let gate = crate::followup::task_gate(&state, id);
    let guard = gate.lock().map_err(|e| e.to_string())?;
    let project_guard = state.project_lock.lock().map_err(|e| e.to_string())?;
    let mut registry = state.children.lock().map_err(|e| e.to_string())?;
    let (task, agent) = {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        let task = db
            .tasks
            .iter()
            .find(|t| t.id == id)
            .ok_or("任务不存在")?
            .clone();
        if task.source != "managed"
            || task.agent_kind != "codex"
            || task.subagent_id.is_some()
            || task.terminal_id.is_some()
        {
            return Err("请在此会话的原生终端中压缩上下文".into());
        }
        if registry.contains_key(id)
            || ["running", "waiting", "queued", "stopping"].contains(&task.status.as_str())
            || !task.queued_messages.is_empty()
        {
            return Err("请等待当前执行和消息队列结束后压缩".into());
        }
        crate::temporary_projects::check_available(&db, &task.project)?;
        let agent = db
            .agents
            .iter()
            .find(|a| a.id == task.agent_id && a.available && !a.custom)
            .ok_or("Codex 不可用")?
            .clone();
        (task, agent)
    };
    let sid = task
        .session_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or("会话尚未建立")?;
    if state
        .shutting_down
        .load(std::sync::atomic::Ordering::Acquire)
    {
        return Err("应用正在退出".into());
    }
    let executable = discovery::resolve(&agent.executable).ok_or("找不到 Codex")?;
    let mut command = crate::process::agent_command(executable)?;
    let mut config = agent.args.iter().chain(task.extra_args.iter());
    while let Some(arg) = config.next() {
        if arg == "-c" || arg == "--config" || arg == "--profile" {
            if let Some(value) = config.next() {
                command.arg(arg).arg(value);
            }
        } else if arg.starts_with("--config=") || arg.starts_with("--profile=") {
            command.arg(arg);
        }
    }
    command
        .arg("app-server")
        .current_dir(&task.project)
        .env("PATH", discovery::path_env())
        .envs(crate::launch::environment(&state, &task)?)
        .env(crate::owned_processes::OWNER_ENV, &state.process_owner)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    let input = child.stdin.take().ok_or("Codex 输入通道不可用")?;
    let output = child.stdout.take().ok_or("Codex 输出通道不可用")?;
    let child = Arc::new(Mutex::new(child));
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(output).lines().map_while(Result::ok) {
            if line.len() > 8 * 1024 * 1024 || tx.send(line).is_err() {
                break;
            }
        }
    });
    let mut session = Session {
        child: child.clone(),
        input,
        output: rx,
        deadline: Instant::now() + Duration::from_secs(180),
    };
    let running = state.update(id, |t| {
        t.status = "running".into();
        t.preview = "正在压缩上下文".into();
    })?;
    registry.insert(id.into(), child.clone());
    drop(registry);
    drop(project_guard);
    drop(guard);
    runtime::emit(app, &running);
    let call_id = format!("manual-compact-{}", uuid::Uuid::new_v4());
    record(&state, id, &call_id, "running", None);
    let result = (|| {
        session.rpc(
            1,
            "initialize",
            json!({"clientInfo":{"name":"oiagent","version":env!("CARGO_PKG_VERSION")}}),
        )?;
        session.send(json!({"method":"initialized"}))?;
        session.rpc(2, "thread/resume", json!({"threadId":sid,"cwd":task.project,"model":if task.model.is_empty() || task.model == "默认模型" { Value::Null } else {json!(task.model)}}))?;
        // Wait for the explicit completion notification, not the RPC acknowledgement.
        session.send(json!({"id":3,"method":"thread/compact/start","params":{"threadId":sid}}))?;
        loop {
            let v = session.receive()?;
            if v["id"] == 3 && v.get("error").is_some() {
                return Err(format!(
                    "Codex 无法压缩上下文：{}",
                    v["error"]["message"]
                        .as_str()
                        .unwrap_or("请检查 CLI 版本和登录状态")
                ));
            }
            if completed(&v, sid) {
                return Ok(());
            }
            if v["method"] == "error" && v["params"]["willRetry"] != true {
                return Err(v["params"]["error"]["message"]
                    .as_str()
                    .unwrap_or("上下文压缩失败")
                    .to_string());
            }
            if v["method"] == "turn/completed" && v["params"]["turn"]["status"] == "failed" {
                return Err("上下文压缩失败".into());
            }
            if v.get("id").is_some() && v.get("method").is_some() {
                session.send(json!({"id":v["id"],"error":{"code":-32601,"message":"Only context compaction is supported"}}))?;
            }
        }
    })();
    drop(session);
    let mut registry = state.children.lock().unwrap();
    // A stopped process must not overwrite a later turn's state.
    if !registry
        .get(id)
        .is_some_and(|registered| Arc::ptr_eq(registered, &child))
    {
        return Err("上下文压缩已中断".into());
    }
    registry.remove(id);
    let cancelled = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .find(|t| t.id == id)
        .is_some_and(|t| ["cancelled", "stopping"].contains(&t.status.as_str()));
    record(
        &state,
        id,
        &call_id,
        if cancelled {
            "interrupted"
        } else if result.is_ok() {
            "completed"
        } else {
            "failed"
        },
        result.as_ref().err().map(String::as_str),
    );
    let updated = state.update(id, |t| {
        t.status = if cancelled {
            "cancelled".into()
        } else {
            task.status.clone()
        };
        t.preview = if cancelled {
            "上下文压缩已中断".into()
        } else if result.is_ok() {
            "上下文已压缩".into()
        } else {
            task.preview.clone()
        };
        if result.is_ok() {
            t.context_usage = Some(crate::context_usage::ContextUsage {
                window: t.context_usage.as_ref().and_then(|u| u.window),
                observed_at: Some(now()),
                ..Default::default()
            });
        }
    })?;
    drop(registry);
    runtime::emit(app, &updated);
    if cancelled {
        return Err("上下文压缩已中断".into());
    }
    let _ = crate::followup::dispatch(app.clone(), id, false);
    result?;
    Ok(updated)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_native_completion_for_the_requested_thread_is_success() {
        assert!(!completed(&json!({"id":3,"result":{}}), "s"));
        assert!(!completed(
            &json!({"method":"item/completed","params":{"threadId":"other","item":{"type":"contextCompaction"}}}),
            "s"
        ));
        assert!(!completed(
            &json!({"method":"item/completed","params":{"threadId":"s","item":{"type":"commandExecution"}}}),
            "s"
        ));
        assert!(completed(
            &json!({"method":"item/completed","params":{"threadId":"s","item":{"type":"contextCompaction"}}}),
            "s"
        ));
    }
    #[cfg(unix)]
    #[test]
    fn native_compaction_handles_success_rejection_and_closed_transport() {
        use std::os::unix::fs::PermissionsExt;
        use tauri::test::{mock_builder, mock_context, noop_assets};
        for mode in ["success", "rejected", "closed"] {
            let dir = tempfile::tempdir().unwrap();
            let executable = dir.path().join("fake-codex");
            let response = match mode {
                "success" => {
                    r#"printf '%s\n' '{"id":3,"result":{}}' '{"method":"item/completed","params":{"threadId":"native","item":{"type":"contextCompaction"}}}'"#
                }
                "rejected" => r#"printf '%s\n' '{"id":3,"error":{"message":"denied"}}'"#,
                _ => r#"printf '%s\n' '{"id":3,"result":{}}'; exit 0"#,
            };
            let script = format!(
                r#"#!/bin/sh
while IFS= read -r line; do
case "$line" in
*'"method":"initialize"'*) printf '%s\n' '{{"id":1,"result":{{}}}}' ;;
*'"method":"thread/resume"'*) printf '%s\n' '{{"id":2,"result":{{}}}}' ;;
*'"method":"thread/compact/start"'*) {response} ;;
esac
done
"#
            );
            std::fs::write(&executable, script).unwrap();
            std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
            let app = mock_builder().build(mock_context(noop_assets())).unwrap();
            app.manage(AppState::load(dir.path().join("data")).unwrap());
            let state = app.state::<AppState>();
            let task: Task = serde_json::from_value(json!({"id":"compact-test","title":"title","prompt":"original","project":dir.path(),"agentId":"codex","agentKind":"codex","status":"completed","createdAt":"","updatedAt":"","preview":"done","usage":{"input":0,"output":0,"cached":0,"known":false},"contextUsage":{"input":1000,"window":200000,"output":50,"cached":0},"sessionId":"native","source":"managed","model":"test","permission":"read-only"})).unwrap();
            {
                let mut db = state.db.lock().unwrap();
                db.agents = vec![serde_json::from_value(json!({"id":"codex","name":"Codex","kind":"codex","executable":executable,"args":[],"available":true,"version":"test","custom":false})).unwrap()];
                db.tasks.push(task);
            }
            let result = compact(app.handle(), "compact-test");
            assert_eq!(result.is_ok(), mode == "success", "{mode}: {result:?}");
            assert!(state.children.lock().unwrap().is_empty());
            let db = state.db.lock().unwrap();
            let task = db.tasks.iter().find(|t| t.id == "compact-test").unwrap();
            assert_eq!(task.status, "completed");
            assert_eq!(
                task.context_usage.as_ref().unwrap().input,
                if mode == "success" { None } else { Some(1000) }
            );
            drop(db);
            let records =
                std::fs::read_to_string(state.dir.join("logs/compact-test.messages.jsonl"))
                    .unwrap();
            let records: Vec<Value> = records
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect();
            assert!(records.iter().all(|r| r["role"] == "tool"));
            assert_eq!(
                records.last().unwrap()["tool"]["state"],
                if mode == "success" {
                    "completed"
                } else {
                    "failed"
                }
            );
        }
    }
}
