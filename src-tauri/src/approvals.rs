//! Claude/Qwen SDK control messages over the same stdin/stdout as the task.
//! Requests are process-scoped and never restored or replayed after restart.
use crate::{
    models::{now, Task},
    runtime,
    store::AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, io::Write, process::ChildStdin};
use tauri::Manager;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: String,
    pub tool: String,
    pub input: Value,
    pub reason: String,
    pub created_at: String,
    pub agent_kind: String,
}
struct Pending {
    view: Approval,
    request_id: String,
    tool_use_id: Option<String>,
}
struct ModeChange {
    id: String,
    mode: String,
    model: bool,
    reply: std::sync::mpsc::Sender<Result<Task, String>>,
}
pub struct Session {
    writer: Option<ChildStdin>,
    initial: Option<Value>,
    init_id: String,
    commands_requested: bool,
    kind: String,
    requests: Vec<Pending>,
    rejected: Vec<Pending>,
    mode_change: Option<ModeChange>,
}
impl Session {
    pub fn new(writer: ChildStdin, kind: &str, prompt: &str, session: Option<&str>) -> Self {
        Self {
            writer: Some(writer),
            kind: kind.into(),
            requests: vec![],
            rejected: vec![],
            mode_change: None,
            init_id: uuid::Uuid::new_v4().to_string(),
            commands_requested: false,
            initial: Some(
                json!({"type":"user","session_id": session.unwrap_or(""),"message":{"role":"user","content":prompt},"parent_tool_use_id":null}),
            ),
        }
    }
    fn write(&mut self, value: &Value) -> Result<(), String> {
        let writer = self.writer.as_mut().ok_or("Agent 输入通道已关闭")?;
        let mut bytes = serde_json::to_vec(value).map_err(|e| e.to_string())?;
        bytes.push(b'\n');
        writer
            .write_all(&bytes)
            .and_then(|_| writer.flush())
            .map_err(|e| format!("无法发送到 Agent：{e}"))
    }
    pub fn initialize(&mut self) -> Result<(), String> {
        let request = if self.kind == "qodercn" {
            json!({"type":"initialize", "hooks":{}})
        } else {
            json!({"subtype":"initialize", "hooks":null})
        };
        self.write(&json!({"type":"control_request","request_id":self.init_id,"request":request}))
    }
}
pub fn supports(agent: &crate::models::Agent) -> bool {
    !agent.custom && matches!(agent.kind.as_str(), "claude" | "qwen" | "qodercn")
}
pub fn pending(state: &AppState, id: &str) -> Vec<Approval> {
    state
        .approvals
        .lock()
        .unwrap()
        .get(id)
        .map(|s| s.requests.iter().map(|p| p.view.clone()).collect())
        .unwrap_or_default()
}
pub fn close(state: &AppState, id: &str) {
    state.approvals.lock().unwrap().remove(id);
}
pub fn live(state: &AppState, id: &str) -> bool {
    state
        .approvals
        .lock()
        .unwrap()
        .get(id)
        .is_some_and(|s| s.writer.is_some())
}

pub fn initializing(state: &AppState, id: &str) -> bool {
    state
        .approvals
        .lock()
        .unwrap()
        .get(id)
        .is_some_and(|s| s.initial.is_some() && s.writer.is_some())
}

// A refusal already made by the user is not a new, unanswered approval.
pub fn unhandled_denials(state: &AppState, id: &str, value: &Value) -> bool {
    let Some(denials) = value["permission_denials"].as_array() else {
        return false;
    };
    let sessions = state.approvals.lock().unwrap();
    denials.iter().any(|denial| {
        !sessions.get(id).is_some_and(|session| {
            session.rejected.iter().any(|p| {
                if let (Some(a), Some(b)) =
                    (p.tool_use_id.as_deref(), denial["tool_use_id"].as_str())
                {
                    a == b
                } else {
                    denial["tool_name"] == p.view.tool && denial["tool_input"] == p.view.input
                }
            })
        })
    })
}

// The caller records the raw protocol line first. Handled frames are not chat text.
pub fn consume<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    value: &Value,
) -> Option<Result<(), String>> {
    let typ = value["type"].as_str()?;
    if typ == "rate_limit_event" {
        crate::quotas::observe(&app.state::<AppState>(), id, value);
        return Some(Ok(()));
    }
    if !matches!(
        typ,
        "control_request" | "control_response" | "control_cancel_request" | "result"
    ) {
        return None;
    }
    let state = app.state::<AppState>();
    let mut sessions = state.approvals.lock().unwrap();
    let session = sessions.get_mut(id)?;
    if typ == "result" {
        session.writer.take();
        session.requests.clear();
        if let Some(change) = session.mode_change.take() {
            let _ = change.reply.send(Err("Agent 已结束，模式未确认".into()));
        }
        return None; // Let runtime parse usage, exit errors and permission denials.
    }
    if typ == "control_response"
        && session.mode_change.as_ref().is_some_and(|change| {
            value["response"]["request_id"].as_str() == Some(change.id.as_str())
        })
    {
        let change = session.mode_change.take().unwrap();
        let result = if value["response"]["subtype"] == "success" {
            state.update(id, |task| {
                if change.model {
                    task.model = change.mode.clone();
                } else {
                    task.permission = change.mode.clone();
                }
            })
        } else {
            let error = &value["response"]["error"];
            Err(format!(
                "设置切换失败：{}",
                error
                    .as_str()
                    .or_else(|| error["message"].as_str())
                    .unwrap_or("Agent 不支持此模式")
            ))
        };
        if let Ok(task) = &result {
            runtime::append_message(
                &state,
                id,
                "system",
                &format!(
                    "{}已切换为 {}",
                    if change.model {
                        "模型"
                    } else {
                        "权限模式"
                    },
                    change.mode
                ),
            );
            runtime::emit(app, task);
        }
        let _ = change.reply.send(result);
        return Some(Ok(())); // A rejected mode change is not a failed Agent turn.
    }
    let result = (|| {
        if typ == "control_response" {
            if value["response"]["request_id"].as_str() == Some(&session.init_id) {
                if value["response"]["subtype"] != "success" {
                    session.writer.take();
                    return Err("Agent 无法建立交互通道，请更新 CLI 或使用原生终端".into());
                }
                // Qwen exposes slash discovery as a separate control request;
                // initialize reports session metadata, not the command catalog.
                if session.kind == "qwen"
                    && !session.commands_requested
                    && session
                        .initial
                        .as_ref()
                        .and_then(|v| v["message"]["content"].as_str())
                        .and_then(crate::commands::slash)
                        .is_some()
                    && value["response"]["response"].get("commands").is_none()
                {
                    session.commands_requested = true;
                    session.init_id = uuid::Uuid::new_v4().to_string();
                    session.write(&json!({"type":"control_request", "request_id":session.init_id, "request":{"subtype":"supported_commands"}}))?;
                    return Ok(());
                }
                crate::commands::observe(&state, id, &value["response"]["response"]);
                if let Some(input) = session.initial.take() {
                    crate::commands::validate_initial(
                        &value["response"]["response"],
                        input["message"]["content"].as_str().unwrap_or(""),
                    )?;
                    session.write(&input)?;
                }
            }
        } else if typ == "control_cancel_request" {
            if let Some(request_id) = value["request_id"].as_str() {
                session.requests.retain(|p| p.request_id != request_id);
            } else {
                session.requests.clear();
            }
        } else {
            let request_id = value["request_id"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("Agent 审批请求缺少标识")?;
            let request = &value["request"];
            if request
                .get("subtype")
                .or_else(|| request.get("type"))
                .and_then(Value::as_str)
                != Some("can_use_tool")
            {
                session.write(&json!({"type":"control_response","response":{"subtype":"error","request_id":request_id,"error":"OiAgent does not support this control request; use the native terminal."}}))?;
                return Ok(());
            }
            if session.requests.iter().any(|p| p.request_id == request_id) {
                return Ok(());
            }
            if session.requests.len() >= 16
                || value.to_string().len() > 512 * 1024
                || !request["input"].is_object()
            {
                session.write(&json!({"type":"control_response","response":{"subtype":"error","request_id":request_id,"error":"Invalid or oversized approval request"}}))?;
                return Ok(());
            }
            session.requests.push(Pending {
                request_id: request_id.into(),
                tool_use_id: request["tool_use_id"].as_str().map(String::from),
                view: Approval {
                    id: uuid::Uuid::new_v4().to_string(),
                    tool: request["tool_name"].as_str().unwrap_or("未知工具").into(),
                    input: request["input"].clone(),
                    reason: ["decision_reason", "description", "blocked_path"]
                        .iter()
                        .filter_map(|k| request[*k].as_str())
                        .collect::<Vec<_>>()
                        .join("\n"),
                    created_at: now(),
                    agent_kind: session.kind.clone(),
                },
            });
        }
        let waiting = !session.requests.is_empty();
        // Keep the process session locked until its task status is synchronized.
        let task = state.update(id, |task| {
            if matches!(task.status.as_str(), "running" | "waiting") {
                task.status = if waiting { "waiting" } else { "running" }.into();
                if let Some(p) = session.requests.first() {
                    task.preview = format!("等待操作：{}", p.view.tool);
                }
            }
        })?;
        runtime::emit(app, &task);
        Ok(())
    })();
    if result.is_err() {
        session.writer.take();
        session.requests.clear();
    }
    Some(result)
}

#[tauri::command]
pub async fn set_task_permission(
    app: tauri::AppHandle,
    id: String,
    permission: String,
) -> Result<Task, String> {
    tauri::async_runtime::spawn_blocking(move || change_permission(&app, &id, &permission))
        .await
        .map_err(|e| e.to_string())?
}
pub(crate) fn change_permission<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    permission: &str,
) -> Result<Task, String> {
    let receiver = {
        let state = app.state::<AppState>();
        let mut sessions = state.approvals.lock().unwrap();
        let session = sessions
            .get_mut(id)
            .ok_or("当前 Agent 不支持即时切换，请在下轮执行时应用")?;
        if !matches!(session.kind.as_str(), "claude" | "qwen" | "qodercn")
            || session.writer.is_none()
        {
            return Err("Agent 交互通道已关闭".into());
        }
        if session.initial.is_some() {
            return Err("Agent 正在连接，请稍后切换".into());
        }
        if session.mode_change.is_some() {
            return Err("正在等待上一次模式切换确认".into());
        }
        let task = state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .find(|t| t.id == id)
            .cloned()
            .ok_or("任务不存在")?;
        if !matches!(task.status.as_str(), "running" | "waiting") {
            return Err("Agent 已停止".into());
        }
        let mode = crate::launch::permission(&session.kind, permission)?;
        if task.permission == mode {
            return Ok(task);
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        let (reply, receiver) = std::sync::mpsc::channel();
        let request = if session.kind == "qodercn" {
            json!({"type":"set_permission_mode", "mode":crate::qodercn::sdk_permission(&mode)})
        } else {
            json!({"subtype":"set_permission_mode", "mode":mode})
        };
        session
            .write(&json!({"type":"control_request","request_id":request_id,"request":request}))?;
        session.mode_change = Some(ModeChange {
            id: request_id,
            mode,
            model: false,
            reply,
        });
        receiver
    };
    // The reader must remain free to receive the acknowledgement and permission requests.
    receiver
        .recv_timeout(std::time::Duration::from_secs(10))
        .map_err(|_| "未收到 Agent 的模式确认，请稍后查看当前权限".to_string())?
}

pub(crate) fn change_model<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    model: &str,
) -> Result<Task, String> {
    let state = app.state::<AppState>();
    let (receiver, request_id) = {
        let mut sessions = state.approvals.lock().unwrap();
        let session = sessions
            .get_mut(id)
            .ok_or("当前 Agent 不支持即时切换模型，可设置下轮模型")?;
        if session.writer.is_none() || session.initial.is_some() {
            return Err("Agent 未连接，请稍后再试".into());
        }
        if session.mode_change.is_some() {
            return Err("正在等待上一次设置确认".into());
        }
        let request_id = uuid::Uuid::new_v4().to_string();
        let (reply, receiver) = std::sync::mpsc::channel();
        let request = if session.kind == "qodercn" {
            json!({"type":"set_model", "model":model})
        } else {
            json!({"subtype":"set_model", "model": if session.kind == "claude" && model.is_empty() { Value::Null } else { json!(model) }})
        };
        session.write(
            &json!({"type":"control_request", "request_id":request_id, "request":request}),
        )?;
        session.mode_change = Some(ModeChange {
            id: request_id.clone(),
            mode: model.into(),
            model: true,
            reply,
        });
        (receiver, request_id)
    };
    match receiver.recv_timeout(std::time::Duration::from_secs(10)) {
        Ok(result) => result,
        Err(_) => {
            if let Some(session) = state.approvals.lock().unwrap().get_mut(id) {
                if session
                    .mode_change
                    .as_ref()
                    .is_some_and(|c| c.id == request_id)
                {
                    session.mode_change.take();
                }
            }
            Err("未收到模型切换确认，请在终端查看当前模型".into())
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub action: String,
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub answers: BTreeMap<String, String>,
}
fn response(request: &Pending, answer: &Answer) -> Result<Value, String> {
    if answer.message.len() > 4000 {
        return Err("补充说明最多 4 KB".into());
    }
    let data = match answer.action.as_str() {
        "allow" => {
            let mut input = request.view.input.clone();
            if matches!(
                request.view.tool.as_str(),
                "AskUserQuestion" | "ask_user_question"
            ) {
                let questions = input["questions"]
                    .as_array()
                    .ok_or("问题格式不支持，请使用原生终端")?;
                if questions.is_empty()
                    || questions.len() > 12
                    || answer.answers.len() != questions.len()
                {
                    return Err("请回答所有问题".into());
                }
                for (i, q) in questions.iter().enumerate() {
                    let key = if request.view.agent_kind == "qwen" {
                        i.to_string()
                    } else {
                        q["question"].as_str().ok_or("问题缺少内容")?.into()
                    };
                    if !answer
                        .answers
                        .get(&key)
                        .is_some_and(|v| !v.trim().is_empty() && v.len() <= 8000)
                    {
                        return Err("请回答所有问题，每项最多 8 KB".into());
                    }
                }
                input["answers"] = serde_json::to_value(&answer.answers).unwrap();
            } else if !answer.answers.is_empty() {
                return Err("此审批不接受问题回答".into());
            }
            json!({"behavior":"allow","updatedInput":input})
        }
        "deny" => {
            json!({"behavior":"deny","message": if answer.message.trim().is_empty() {"用户拒绝了本次操作，请调整方案。"} else {&answer.message}})
        }
        _ => return Err("不支持的审批操作".into()),
    };
    Ok(
        json!({"type":"control_response","response":{"subtype":"success","request_id":request.request_id,"response":data}}),
    )
}
#[tauri::command]
pub fn task_approvals(state: tauri::State<AppState>, id: String) -> Vec<Approval> {
    pending(&state, &id)
}
#[tauri::command]
pub async fn answer_approval(
    app: tauri::AppHandle,
    id: String,
    approval_id: String,
    answer: Answer,
) -> Result<Task, String> {
    tauri::async_runtime::spawn_blocking(move || answer_inner(&app, &id, &approval_id, answer))
        .await
        .map_err(|e| e.to_string())?
}
pub(crate) fn answer_inner<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    approval_id: &str,
    answer: Answer,
) -> Result<Task, String> {
    let state = app.state::<AppState>();
    let mut sessions = state.approvals.lock().unwrap();
    let session = sessions
        .get_mut(id)
        .ok_or("审批已失效，Agent 已结束或重新启动")?;
    let position = session
        .requests
        .iter()
        .position(|p| p.view.id == approval_id)
        .ok_or("审批已处理或撤回，请刷新")?;
    let frame = response(&session.requests[position], &answer)?;
    // Do not remove a pending request unless the response was successfully written.
    let task = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .find(|t| t.id == id)
        .cloned()
        .ok_or("任务不存在")?;
    if !matches!(task.status.as_str(), "running" | "waiting") {
        return Err("任务已停止，审批失效".into());
    }
    session.write(&frame)?;
    let handled = session.requests.remove(position);
    let waiting = !session.requests.is_empty();
    let task = state.update(id, |t| {
        if matches!(t.status.as_str(), "running" | "waiting") {
            t.status = if waiting { "waiting" } else { "running" }.into();
            t.preview = if waiting {
                "仍有操作等待处理"
            } else {
                "已回复 Agent，继续执行"
            }
            .into();
        }
    })?;
    runtime::append_message(
        &state,
        id,
        "system",
        &format!(
            "{}：{}",
            if answer.action == "allow" {
                "已允许本次操作"
            } else {
                "已拒绝本次操作"
            },
            handled.view.tool
        ),
    );
    if answer.action == "deny" {
        session.rejected.push(handled);
    }
    runtime::emit(app, &task);
    Ok(task)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader},
        process::Stdio,
        time::Duration,
    };
    fn request(kind: &str, tool: &str, input: Value) -> Pending {
        Pending {
            request_id: "native-id".into(),
            tool_use_id: None,
            view: Approval {
                id: "local-id".into(),
                tool: tool.into(),
                input,
                reason: "".into(),
                created_at: now(),
                agent_kind: kind.into(),
            },
        }
    }
    fn answer(action: &str) -> Answer {
        Answer {
            action: action.into(),
            message: String::new(),
            answers: BTreeMap::new(),
        }
    }
    #[test]
    fn replies_preserve_original_input_and_do_not_grant_future_permissions() {
        let req = request(
            "claude",
            "Bash",
            json!({"command":"git diff", "timeout":3000}),
        );
        let reply = response(&req, &answer("allow")).unwrap();
        assert_eq!(reply["response"]["request_id"], "native-id");
        assert_eq!(
            reply["response"]["response"],
            json!({"behavior":"allow","updatedInput":req.view.input})
        );
        assert_eq!(
            response(&req, &answer("deny")).unwrap()["response"]["response"]["behavior"],
            "deny"
        );
        assert!(response(&req, &answer("always")).is_err());
        let mut invalid = answer("allow");
        invalid
            .answers
            .insert("command".into(), "something else".into());
        assert!(response(&req, &invalid).is_err());
    }
    #[test]
    fn question_answers_follow_each_agents_protocol_and_require_every_question() {
        for (kind, key) in [("claude", "Which database?"), ("qwen", "0")] {
            let req = request(
                kind,
                "AskUserQuestion",
                json!({"questions":[{"question":"Which database?","options":[{"label":"SQLite"}]}],"metadata":{"keep":true}}),
            );
            assert!(response(&req, &answer("allow")).is_err());
            let mut valid = answer("allow");
            valid.answers.insert(key.into(), "SQLite".into());
            let frame = response(&req, &valid).unwrap();
            assert_eq!(
                frame["response"]["response"]["updatedInput"]["answers"][key],
                "SQLite"
            );
            assert_eq!(
                frame["response"]["response"]["updatedInput"]["metadata"]["keep"],
                true
            );
            valid.answers.insert("extra".into(), "value".into());
            assert!(response(&req, &valid).is_err());
        }
    }
    #[test]
    fn already_rejected_tools_do_not_create_a_phantom_waiting_state() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let value = json!({"permission_denials":[{"tool_name":"Bash","tool_input":{"command":"git diff"}}]});
        assert!(unhandled_denials(&state, "task", &value));
        state.approvals.lock().unwrap().insert(
            "task".into(),
            Session {
                writer: None,
                initial: None,
                init_id: String::new(),
                commands_requested: false,
                kind: "claude".into(),
                requests: vec![],
                mode_change: None,
                rejected: vec![request("claude", "Bash", json!({"command":"git diff"}))],
            },
        );
        assert!(!unhandled_denials(&state, "task", &value));
        assert!(unhandled_denials(
            &state,
            "task",
            &json!({"permission_denials":[{"tool_name":"Bash","tool_input":{"command":"git push"}}]})
        ));
    }
    #[test]
    fn process_scoped_approval_roundtrip_and_withdrawal() {
        for kind in ["claude", "qwen", "qodercn"] {
            let app = tauri::test::mock_builder()
                .build(tauri::test::mock_context(tauri::test::noop_assets()))
                .unwrap();
            let dir = tempfile::tempdir().unwrap();
            let state = AppState::load(dir.path().into()).unwrap();
            let task: Task = serde_json::from_value(json!({"id":"task","title":"test","prompt":"hello","project":"/tmp","agentId":"claude","agentKind":kind,"status":"running","preview":"","createdAt":"","updatedAt":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"default","exitCode":null,"sessionId":null})).unwrap();
            state.db.lock().unwrap().tasks.push(task);
            app.manage(state);
            let mut child = crate::process::background_command(std::env::current_exe().unwrap())
                .args(["--exact", "approvals::tests::protocol_probe", "--nocapture"])
                .env("OIAGENT_APPROVAL_PROBE", "1")
                .env("OIAGENT_APPROVAL_KIND", kind)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            let (tx, rx) = std::sync::mpsc::channel();
            let out = child.stdout.take().unwrap();
            std::thread::spawn(move || {
                for line in BufReader::new(out).lines().map_while(Result::ok) {
                    if let Ok(value) = serde_json::from_str::<Value>(&line) {
                        let _ = tx.send(value);
                    }
                }
            });
            let state = app.state::<AppState>();
            let mut session = Session::new(
                child.stdin.take().unwrap(),
                kind,
                if kind == "qwen" { "/fixture" } else { "hello" },
                None,
            );
            session.initialize().unwrap();
            state
                .approvals
                .lock()
                .unwrap()
                .insert("task".into(), session);
            let next = || {
                rx.recv_timeout(Duration::from_secs(5))
                    .expect("fake Agent did not reply")
            };
            consume(app.handle(), "task", &next()).unwrap().unwrap(); // initialize
            if kind == "qwen" {
                consume(app.handle(), "task", &next()).unwrap().unwrap();
            }
            let native_request = next();
            consume(app.handle(), "task", &native_request)
                .unwrap()
                .unwrap();
            consume(app.handle(), "task", &native_request)
                .unwrap()
                .unwrap(); // dedupe
            assert_eq!(pending(&state, "task").len(), 1);
            assert_eq!(state.db.lock().unwrap().tasks[0].status, "waiting");
            let withdrawn = pending(&state, "task")[0].id.clone();
            consume(
                app.handle(),
                "task",
                &json!({"type":"control_cancel_request","request_id":"first"}),
            )
            .unwrap()
            .unwrap();
            assert!(answer_inner(app.handle(), "task", &withdrawn, answer("allow")).is_err());
            assert_eq!(state.db.lock().unwrap().tasks[0].status, "running");
            let mut second = native_request;
            second["request_id"] = json!("second");
            consume(app.handle(), "task", &second).unwrap().unwrap();
            let id = pending(&state, "task")[0].id.clone();
            assert!(live(&state, "task"));
            let mode = if kind != "qwen" { "auto" } else { "auto-edit" };
            let handle = app.handle().clone();
            let worker = std::thread::spawn(move || change_permission(&handle, "task", mode));
            let acknowledgement = next();
            assert_eq!(state.db.lock().unwrap().tasks[0].permission, "default");
            consume(app.handle(), "task", &acknowledgement)
                .unwrap()
                .unwrap();
            assert_eq!(worker.join().unwrap().unwrap().permission, mode);
            assert_eq!(
                pending(&state, "task").len(),
                1,
                "switching mode must not auto-approve an existing request"
            );
            let handle = app.handle().clone();
            let worker = std::thread::spawn(move || change_permission(&handle, "task", "plan"));
            consume(app.handle(), "task", &next()).unwrap().unwrap();
            assert!(worker
                .join()
                .unwrap()
                .unwrap_err()
                .contains("unsupported mode"));
            assert_eq!(state.db.lock().unwrap().tasks[0].permission, mode);
            for (model, success) in [("model-v2", true), ("unknown-model", false)] {
                let handle = app.handle().clone();
                let worker = std::thread::spawn(move || change_model(&handle, "task", model));
                let response = next();
                assert_ne!(state.db.lock().unwrap().tasks[0].model, model);
                consume(app.handle(), "task", &response).unwrap().unwrap();
                assert_eq!(worker.join().unwrap().is_ok(), success);
                assert_eq!(state.db.lock().unwrap().tasks[0].model, "model-v2");
                assert_eq!(pending(&state, "task").len(), 1);
            }
            answer_inner(app.handle(), "task", &id, answer("allow")).unwrap();
            assert!(answer_inner(app.handle(), "task", &id, answer("allow")).is_err());
            assert_eq!(state.db.lock().unwrap().tasks[0].status, "running");
            assert!(consume(app.handle(), "task", &next()).is_none()); // result closes input
            assert!(!live(&state, "task"));
            assert!(pending(&state, "task").is_empty());
            assert!(child.wait().unwrap().success());
            close(&state, "task");
            assert!(answer_inner(app.handle(), "task", &id, answer("allow")).is_err());
        }
    }
    #[test]
    fn protocol_probe() {
        if std::env::var("OIAGENT_APPROVAL_PROBE").as_deref() != Ok("1") {
            return;
        }
        let mut lines = std::io::stdin().lock().lines();
        let init: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        let discriminator = if std::env::var("OIAGENT_APPROVAL_KIND").as_deref() == Ok("qodercn") {
            "type"
        } else {
            "subtype"
        };
        assert_eq!(init["request"][discriminator], "initialize");
        println!(
            "{}",
            json!({"type":"control_response","response":{"subtype":"success","request_id":init["request_id"],"response":{}}})
        );
        std::io::stdout().flush().unwrap();
        let qwen = std::env::var("OIAGENT_APPROVAL_KIND").as_deref() == Ok("qwen");
        if qwen {
            let discovery: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
            assert_eq!(discovery["request"]["subtype"], "supported_commands");
            println!(
                "{}",
                json!({"type":"control_response","response":{"subtype":"success","request_id":discovery["request_id"],"response":{"commands":["fixture"]}}})
            );
            std::io::stdout().flush().unwrap();
        }
        let user: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        assert_eq!(
            user["message"]["content"],
            if qwen { "/fixture" } else { "hello" }
        );
        println!(
            "{}",
            json!({"type":"control_request","request_id":"first","request":{(discriminator):"can_use_tool","tool_name":"Bash","input":{"command":"git diff"}}})
        );
        std::io::stdout().flush().unwrap();
        for success in [true, false] {
            let change: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
            assert_eq!(change["request"][discriminator], "set_permission_mode");
            if success {
                assert!(matches!(
                    change["request"]["mode"].as_str(),
                    Some("auto" | "auto-edit")
                ));
            } else {
                assert_eq!(change["request"]["mode"], "plan");
            }
            println!(
                "{}",
                json!({"type":"control_response","response":{"subtype": if success {"success"} else {"error"},
                "request_id":change["request_id"],"response":{},"error":"unsupported mode"}})
            );
            std::io::stdout().flush().unwrap();
        }
        for success in [true, false] {
            let change: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
            assert_eq!(change["request"][discriminator], "set_model");
            assert_eq!(
                change["request"]["model"],
                if success { "model-v2" } else { "unknown-model" }
            );
            println!(
                "{}",
                json!({"type":"control_response","response":{"subtype":if success {"success"} else {"error"},"request_id":change["request_id"],"response":{},"error":"unsupported model"}})
            );
            std::io::stdout().flush().unwrap();
        }
        let reply: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        assert_eq!(reply["response"]["request_id"], "second");
        assert_eq!(
            reply["response"]["response"]["updatedInput"]["command"],
            "git diff"
        );
        println!(
            "{}",
            json!({"type":"result","is_error":false,"result":"done"})
        );
        std::io::stdout().flush().unwrap();
        assert!(lines.next().is_none(), "stdin should close after result");
    }
}
