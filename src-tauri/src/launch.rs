use crate::models::{Agent, Task};
use std::collections::BTreeMap;

pub fn permission(kind: &str, value: &str) -> Result<String, String> {
    let value = match (kind, value) {
        ("claude" | "qwen" | "gemini" | "opencode", "read-only") => "plan",
        ("claude", "workspace-write") => "acceptEdits",
        ("qwen", "workspace-write") => "auto-edit",
        ("gemini", "workspace-write") => "auto_edit",
        ("opencode", "workspace-write") => "build",
        ("aider", "read-only") => "ask",
        ("aider", "workspace-write") => "code",
        ("goose", "read-only") => "chat",
        ("goose", "workspace-write") => "approve",
        (_, v) => v,
    };
    let modes: &[&str] = match kind {
        "codex" => &["read-only", "workspace-write", "danger-full-access"],
        "claude" => &[
            "plan",
            "default",
            "acceptEdits",
            "auto",
            "dontAsk",
            "bypassPermissions",
        ],
        "qwen" => &["plan", "default", "auto-edit", "yolo"],
        "gemini" => &["plan", "default", "auto_edit", "yolo"],
        "opencode" => &["plan", "build"],
        "aider" => &["ask", "code", "architect"],
        "goose" => &["chat", "approve", "auto"],
        _ => return Ok(value.into()),
    };
    if modes.contains(&value) {
        Ok(value.into())
    } else {
        Err(format!("{kind} 不支持权限模式 {value}"))
    }
}
pub fn validate(args: &[String], env: &BTreeMap<String, String>) -> Result<(), String> {
    if args.iter().any(|a| a.contains('\0')) {
        return Err("启动参数不能包含空字符".into());
    }
    for (key, value) in env {
        if key.is_empty() || key.contains(['=', '\0']) || value.contains('\0') {
            return Err("环境变量名称和值无效".into());
        }
    }
    Ok(())
}
pub fn resumable(kind: &str) -> bool {
    ["codex", "claude", "qwen", "gemini", "opencode"].contains(&kind)
}
/// Interactive argv never goes through a shell. The CLI owns prompts and mouse input.
pub fn tui_arguments(agent: &Agent, task: &Task) -> Result<Vec<String>, String> {
    let mode = permission(&agent.kind, &task.permission)?;
    let mut a = vec![];
    match agent.kind.as_str() {
        "codex" => {
            if let Some(id) = &task.session_id {
                a.extend(["resume".into(), id.clone()]);
            }
            a.extend(["--sandbox".into(), mode]);
        }
        "claude" => {
            a.extend(["--permission-mode".into(), mode]);
            if let Some(id) = &task.session_id {
                a.extend(["--resume".into(), id.clone()]);
            }
        }
        "qwen" | "gemini" => {
            a.extend(["--approval-mode".into(), mode]);
            if let Some(id) = &task.session_id {
                a.extend(["--resume".into(), id.clone()]);
            }
        }
        "opencode" => {
            a.extend(["--agent".into(), mode]);
            if let Some(id) = &task.session_id {
                a.extend(["--session".into(), id.clone()]);
            }
        }
        "aider" => a.extend([
            "--chat-mode".into(),
            mode,
            "--no-auto-commits".into(),
            "--no-dirty-commits".into(),
        ]),
        "goose" => a.push("session".into()),
        _ => return Err("自定义程序请通过交互终端指定 TUI 启动命令".into()),
    }
    if !task.model.is_empty() && task.model != "默认模型" {
        a.extend(["--model".into(), task.model.clone()]);
    }
    a.extend(task.extra_args.clone());
    Ok(a)
}

pub fn environment(
    state: &crate::store::AppState,
    task: &Task,
) -> Result<BTreeMap<String, String>, String> {
    let envs = state.launch_envs.lock().map_err(|e| e.to_string())?;
    if !task.env_keys.is_empty() && !envs.contains_key(&task.id) {
        return Err("任务的环境变量已随应用退出清除，请重新配置任务后启动".into());
    }
    Ok(envs.get(&task.id).cloned().unwrap_or_default())
}
pub fn validate_protocol(kind: &str, args: &[String]) -> Result<(), String> {
    if !crate::discovery::builtin(kind) {
        return Ok(());
    }
    let reserved = [
        "--",
        "--json",
        "--output-format",
        "--input-format",
        "--format",
        "--prompt",
        "-p",
        "--message",
        "--text",
        "--resume",
        "--session",
        "--sandbox",
        "--permission-mode",
        "--approval-mode",
        "--chat-mode",
        "--agent",
        "--model",
        "--yolo",
        "--dangerously-skip-permissions",
        "--dangerously-bypass-approvals-and-sandbox",
        "--full-auto",
    ];
    if let Some(a) = args
        .iter()
        .find(|a| reserved.contains(&a.split('=').next().unwrap_or("")))
    {
        return Err(format!(
            "参数 {a} 由任务表单管理，请使用模型、权限和会话选项设置"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn claude_auto_is_preserved_for_headless_and_tui() {
        let agent = Agent {
            id: "claude".into(),
            kind: "claude".into(),
            name: "Claude Code".into(),
            executable: "claude".into(),
            args: vec![],
            available: true,
            version: String::new(),
            custom: false,
        };
        let task: Task = serde_json::from_value(serde_json::json!({
            "id":"task", "title":"task", "prompt":"hello", "project":"/tmp", "agentId":"claude", "agentKind":"claude",
            "status":"completed", "createdAt":"", "updatedAt":"", "preview":"", "usage":{"input":0,"output":0,"cached":0,"known":false}, "sessionId":"session", "source":"managed", "model":"", "permission":"auto", "exitCode":null
        })).unwrap();
        assert_eq!(permission("claude", "auto").unwrap(), "auto");
        for args in [
            crate::runtime::arguments(&agent, &task),
            tui_arguments(&agent, &task).unwrap(),
        ] {
            assert!(args
                .windows(2)
                .any(|pair| pair == ["--permission-mode", "auto"]));
            assert!(!args
                .iter()
                .any(|arg| arg.contains("bypass") || arg.contains("skip-permissions")));
        }
    }
}
