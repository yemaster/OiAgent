use crate::models::{Agent, Task};
use std::collections::BTreeMap;

/// Native command-entry syntax: POSIX quoting on Unix, Windows argv rules on Windows.
/// Structured task arguments never pass through this parser.
pub fn parse_command(command: &str) -> Result<(String, Vec<String>), String> {
    let command = command.trim();
    if command.is_empty() || command.contains('\0') {
        return Err("请输入有效的启动命令".into());
    }
    #[cfg(not(windows))]
    let mut words = shell_words::split(command).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    let mut words = windows_command_words(command)?;
    if words.is_empty() || words[0].is_empty() {
        return Err("请输入启动命令".into());
    }
    Ok((words.remove(0), words))
}

#[cfg(windows)]
fn windows_command_words(command: &str) -> Result<Vec<String>, String> {
    #[link(name = "shell32")]
    extern "system" {
        fn CommandLineToArgvW(command: *const u16, count: *mut i32) -> *mut *mut u16;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut std::ffi::c_void) -> *mut std::ffi::c_void;
    }
    let encoded: Vec<u16> = command.encode_utf16().chain(Some(0)).collect();
    let mut count = 0;
    // The OS owns the allocation, including each NUL-terminated argument.
    let argv = unsafe { CommandLineToArgvW(encoded.as_ptr(), &mut count) };
    if argv.is_null() {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let result = (0..count as usize)
        .map(|index| unsafe {
            let value = *argv.add(index);
            let mut len = 0;
            while *value.add(len) != 0 {
                len += 1;
            }
            String::from_utf16(std::slice::from_raw_parts(value, len)).map_err(|e| e.to_string())
        })
        .collect();
    unsafe {
        LocalFree(argv.cast());
    }
    result
}

/// Substitute template tokens once; values may themselves contain literal tokens.
pub fn expand_argument(template: &str, prompt: &str, project: &str) -> String {
    let mut output = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(index) = rest.find('{') {
        output.push_str(&rest[..index]);
        rest = &rest[index..];
        if let Some(tail) = rest.strip_prefix("{prompt}") {
            output.push_str(prompt);
            rest = tail;
        } else if let Some(tail) = rest.strip_prefix("{project}") {
            output.push_str(project);
            rest = tail;
        } else {
            output.push('{');
            rest = &rest[1..];
        }
    }
    output.push_str(rest);
    output
}

/// Shell flags depend on the chosen interpreter, not the host OS. A Windows
/// user may have Git Bash in SHELL; PowerShell can also be installed on Unix.
pub fn shell_arguments(shell: &str, command: &str) -> Vec<String> {
    if command.trim().is_empty() {
        return vec![];
    }
    let name = shell
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(shell)
        .to_ascii_lowercase();
    let flags: &[&str] = match name.as_str() {
        "powershell" | "powershell.exe" | "pwsh" | "pwsh.exe" => &["-NoLogo", "-Command"],
        "cmd" | "cmd.exe" => &["/D", "/S", "/C"],
        _ => &["-lc"],
    };
    flags
        .iter()
        .map(|flag| (*flag).to_owned())
        .chain([command.to_owned()])
        .collect()
}

pub fn permission(kind: &str, value: &str) -> Result<String, String> {
    let value = match (kind, value) {
        ("claude" | "qwen" | "gemini" | "opencode" | "qodercn", "read-only") => "plan",
        ("claude", "workspace-write") => "acceptEdits",
        ("qodercn", "workspace-write") => "accept_edits",
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
        "qodercn" => &[
            "plan",
            "default",
            "accept_edits",
            "auto",
            "dont_ask",
            "bypass_permissions",
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
    ["codex", "claude", "qwen", "gemini", "opencode", "qodercn"].contains(&kind)
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
        "claude" | "qodercn" => {
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
    if kind == "qodercn"
        && args.iter().any(|a| {
            [
                "-o",
                "-m",
                "-r",
                "-c",
                "-w",
                "--cwd",
                "--continue",
                "--print",
                "--no-session-persistence",
                "--remote",
                "--remote-session",
                "--remote-control",
                "--teleport",
                "--sdk",
            ]
            .contains(&a.split('=').next().unwrap_or(""))
        })
    {
        return Err("此参数由任务的项目、模型和会话设置管理".into());
    }
    let reserved = [
        "--",
        "--json",
        "--output-format",
        "--input-format",
        "--permission-prompt-tool",
        "--permission-prompts",
        "--channel",
        "--format",
        "--prompt",
        "-p",
        "--message",
        "--text",
        "--resume",
        "--session",
        "--session-id",
        "--fork-session",
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

#[cfg(test)]
mod argv_tests {
    use super::*;
    #[test]
    fn template_values_are_never_expanded_twice() {
        assert_eq!(
            expand_argument(
                "{project}::{prompt}::{unknown}::{prompt}",
                "keep {project} and {prompt}",
                "/work/{prompt}"
            ),
            "/work/{prompt}::keep {project} and {prompt}::{unknown}::keep {project} and {prompt}"
        );
    }
    #[test]
    fn shell_flags_follow_the_interpreter_on_every_platform() {
        let command = "echo '中文' & echo \"two words\"";
        for (shell, expected) in [
            (r"C:\Program Files\Git\bin\bash.exe", vec!["-lc", command]),
            ("/bin/zsh", vec!["-lc", command]),
            ("/usr/local/bin/pwsh", vec!["-NoLogo", "-Command", command]),
            (
                r"C:\Windows\System32\cmd.exe",
                vec!["/D", "/S", "/C", command],
            ),
            ("PowerShell.EXE", vec!["-NoLogo", "-Command", command]),
        ] {
            assert_eq!(shell_arguments(shell, command), expected);
            assert!(shell_arguments(shell, "  ").is_empty());
        }
    }

    #[test]
    fn all_builtin_launches_preserve_model_config_prompt_and_resume_boundaries() {
        let prompt = "--settings literal \"quotes\" '中文'\n%PATH% $(echo nope) & |";
        let model = "provider/model with spaces";
        for &(kind, name) in crate::discovery::BUILTINS {
            let agent = Agent {
                id: kind.into(),
                kind: kind.into(),
                name: name.into(),
                executable: kind.into(),
                args: vec![],
                available: true,
                version: String::new(),
                custom: false,
            };
            let mut task: Task = serde_json::from_value(serde_json::json!({
                "id":"t", "title":"t", "prompt":prompt, "project":"C:\\Project Files\\中文", "agentId":kind,"agentKind":kind,
                "status":"queued", "createdAt":"", "updatedAt":"", "preview":"", "usage":{"input":0,"output":0,"cached":0,"known":false},
                "source":"managed", "model":model, "permission":"read-only", "exitCode":null,
                "extraArgs":["--test-option", "{\"name\":\"a b\",\"path\":\"C:\\\\work\"}"]
            })).unwrap();
            for session in [None, Some("native session".into())] {
                task.session_id = session;
                for args in [
                    crate::runtime::arguments(&agent, &task),
                    tui_arguments(&agent, &task).unwrap(),
                ] {
                    assert!(
                        args.windows(2).any(|p| p == ["--model", model]),
                        "{kind}: {args:?}"
                    );
                    assert!(
                        args.windows(2).any(|p| p == task.extra_args.as_slice()),
                        "{kind}: {args:?}"
                    );
                    if resumable(kind) && task.session_id.is_some() {
                        assert!(args.contains(&"native session".into()), "{kind}: {args:?}");
                    }
                }
                let args = crate::runtime::arguments(&agent, &task);
                let expected_prompt = match kind {
                    "gemini" => format!("--prompt={prompt}"),
                    "aider" => format!("--message={prompt}"),
                    "goose" => format!("--text={prompt}"),
                    _ => prompt.to_owned(),
                };
                assert_eq!(args.last().unwrap(), &expected_prompt, "{kind}");
                if matches!(kind, "codex" | "claude" | "qodercn" | "opencode") {
                    assert_eq!(args[args.len() - 2], "--", "{kind}");
                }
            }
        }
    }
    #[cfg(windows)]
    #[test]
    fn windows_command_entry_keeps_backslashes_spaces_and_json_quotes() {
        let (exe,args) = parse_command(r#""C:\Program Files\Agent\node.exe" "C:\work files\cli.js" --settings "{\"model\":\"中文 model\"}" "" C:\work\file.txt"#).unwrap();
        assert_eq!(exe, r"C:\Program Files\Agent\node.exe");
        assert_eq!(
            args,
            [
                r"C:\work files\cli.js",
                "--settings",
                r#"{"model":"中文 model"}"#,
                "",
                r"C:\work\file.txt"
            ]
        );
    }
    #[cfg(unix)]
    #[test]
    fn posix_command_entry_keeps_literal_json_and_quoted_paths() {
        let (exe, args) = parse_command(
            r#"'/path with spaces/agent' --settings '{"model":"中文 model"}' '' '$(echo nope)'"#,
        )
        .unwrap();
        assert_eq!(exe, "/path with spaces/agent");
        assert_eq!(
            args,
            [
                "--settings",
                r#"{"model":"中文 model"}"#,
                "",
                "$(echo nope)"
            ]
        );
    }
}
