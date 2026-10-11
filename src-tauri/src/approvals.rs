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
pub struct Session {
    writer: Option<ChildStdin>,
    initial: Option<Value>,
    init_id: String,
    kind: String,
    requests: Vec<Pending>,
    rejected: Vec<Pending>,
}
impl Session {
    pub fn new(writer: ChildStdin, kind: &str, prompt: &str, session: Option<&str>) -> Self {
        Self {
            writer: Some(writer),
            kind: kind.into(),
            requests: vec![],
            rejected: vec![],
            init_id: uuid::Uuid::new_v4().to_string(),
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
        self.write(&json!({"type":"control_request","request_id":self.init_id,"request":{"subtype":"initialize","hooks":null}}))
    }
}
pub fn supports(agent: &crate::models::Agent) -> bool {
    !agent.custom && matches!(agent.kind.as_str(), "claude" | "qwen")
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
        return None; // Let runtime parse usage, exit errors and permission denials.
    }
    let result = (|| {
        if typ == "control_response" {
            if value["response"]["request_id"].as_str() == Some(&session.init_id) {
                if value["response"]["subtype"] != "success" {
                    session.writer.take();
                    return Err("Agent 无法建立交互通道，请更新 CLI 或使用原生终端".into());
                }
                if let Some(input) = session.initial.take() {
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
            if request["subtype"] != "can_use_tool" {
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
                kind: "claude".into(),
                requests: vec![],
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
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().into()).unwrap();
        let task: Task = serde_json::from_value(json!({"id":"task","title":"test","prompt":"hello","project":"/tmp","agentId":"claude","agentKind":"claude","status":"running","preview":"","createdAt":"","updatedAt":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"default","exitCode":null,"sessionId":null})).unwrap();
        state.db.lock().unwrap().tasks.push(task);
        app.manage(state);
        let mut child = crate::process::background_command(std::env::current_exe().unwrap())
            .args(["--exact", "approvals::tests::protocol_probe", "--nocapture"])
            .env("OIAGENT_APPROVAL_PROBE", "1")
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
        let mut session = Session::new(child.stdin.take().unwrap(), "claude", "hello", None);
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
    #[test]
    fn protocol_probe() {
        if std::env::var("OIAGENT_APPROVAL_PROBE").as_deref() != Ok("1") {
            return;
        }
        let mut lines = std::io::stdin().lock().lines();
        let init: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        assert_eq!(init["request"]["subtype"], "initialize");
        println!(
            "{}",
            json!({"type":"control_response","response":{"subtype":"success","request_id":init["request_id"],"response":{}}})
        );
        std::io::stdout().flush().unwrap();
        let user: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
        assert_eq!(user["message"]["content"], "hello");
        println!(
            "{}",
            json!({"type":"control_request","request_id":"first","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{"command":"git diff"}}})
        );
        std::io::stdout().flush().unwrap();
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
