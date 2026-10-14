//! Qoder CN uses the SDK stdio protocol only with an explicit auth payload.
//! See @qodercn-ai/qodercn-agent-sdk's RuntimeLaunch.buildEnv/buildArgs.
use std::{
    collections::BTreeMap,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

pub fn config_root(home: &Path) -> PathBuf {
    std::env::var_os("QODERCN_CONFIG_DIR")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".qoder-cn"))
}

// The CLI flags use snake_case; the SDK control protocol uses camelCase.
pub fn sdk_permission(mode: &str) -> &str {
    match mode {
        "accept_edits" => "acceptEdits",
        "dont_ask" => "dontAsk",
        "bypass_permissions" => "bypassPermissions",
        other => other,
    }
}

pub fn prepare_sdk(
    command: &mut Command,
    env: &BTreeMap<String, String>,
) -> Result<tempfile::NamedTempFile, String> {
    let token = env
        .get("QODERCN_PERSONAL_ACCESS_TOKEN")
        .cloned()
        .or_else(|| std::env::var("QODERCN_PERSONAL_ACCESS_TOKEN").ok())
        .filter(|token| !token.trim().is_empty());
    let payload = match token {
        Some(token) => serde_json::json!({"type":"accessToken", "accessToken":token}),
        None => serde_json::json!({"type":"qodercli"}),
    };
    // NamedTempFile is private and remains alive until the CLI process exits.
    let mut file = tempfile::Builder::new()
        .prefix("oiagent-qodercn-")
        .suffix(".json")
        .tempfile()
        .map_err(|e| e.to_string())?;
    file.write_all(payload.to_string().as_bytes())
        .and_then(|_| file.flush())
        .map_err(|e| e.to_string())?;
    command
        .env("QODER_AGENT_SDK_ENTRYPOINT", "oiagent")
        .env("QODER_SDK_AUTH_PAYLOAD_FILE", file.path());
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        launch,
        models::{Agent, Task},
        runtime,
    };
    use serde_json::json;

    #[test]
    fn qodercn_launch_uses_native_modes_resume_and_safe_argument_boundaries() {
        assert_eq!(sdk_permission("accept_edits"), "acceptEdits");
        assert_eq!(sdk_permission("dont_ask"), "dontAsk");
        assert_eq!(sdk_permission("bypass_permissions"), "bypassPermissions");
        assert_eq!(sdk_permission("auto"), "auto");
        let agent = Agent {
            id: "qodercn".into(),
            kind: "qodercn".into(),
            name: "Qoder CLI CN".into(),
            executable: "qodercn".into(),
            args: vec![],
            available: true,
            version: String::new(),
            custom: false,
        };
        let mut task: Task = serde_json::from_value(json!({"id":"task","title":"task","prompt":"--not-a-flag","project":"/tmp","agentId":"qodercn","agentKind":"qodercn","status":"completed","createdAt":"","updatedAt":"","preview":"","usage":{"input":0,"output":0,"cached":0,"known":false},"sessionId":"native-session","source":"managed","model":"model-id","permission":"auto","exitCode":null})).unwrap();
        task.extra_args = vec!["--reasoning-effort".into(), "high".into()];
        assert!(crate::approvals::supports(&agent));
        assert!(launch::resumable("qodercn"));
        assert_eq!(
            launch::permission("qodercn", "workspace-write").unwrap(),
            "accept_edits"
        );
        for mode in [
            "plan",
            "default",
            "auto",
            "accept_edits",
            "dont_ask",
            "bypass_permissions",
        ] {
            task.permission = mode.into();
            for args in [
                runtime::arguments(&agent, &task),
                launch::tui_arguments(&agent, &task).unwrap(),
            ] {
                assert!(args
                    .windows(2)
                    .any(|pair| pair == ["--permission-mode", mode]));
                assert!(args
                    .windows(2)
                    .any(|pair| pair == ["--resume", "native-session"]));
                assert!(!args
                    .iter()
                    .any(|arg| arg == "--verbose" || arg == "--approval-mode"));
            }
        }
        let args = runtime::arguments(&agent, &task);
        assert_eq!(&args[args.len() - 2..], &["--", "--not-a-flag"]);
        assert!(launch::validate_protocol("qodercn", &["-o=json".into()]).is_err());
        assert!(launch::validate_protocol("qodercn", &["--cwd=/other".into()]).is_err());
        assert!(launch::validate_protocol("qodercn", &task.extra_args).is_ok());
    }

    #[test]
    fn sdk_auth_file_is_private_ephemeral_and_not_a_command_argument() {
        let mut command = Command::new("qodercn");
        let env = BTreeMap::from([(
            "QODERCN_PERSONAL_ACCESS_TOKEN".into(),
            "test-token-not-real".into(),
        )]);
        let guard = prepare_sdk(&mut command, &env).unwrap();
        let path = guard.path().to_path_buf();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(&path).unwrap()).unwrap(),
            json!({"type":"accessToken", "accessToken":"test-token-not-real"})
        );
        assert_eq!(command.get_args().count(), 0);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o077,
                0
            );
        }
        drop(guard);
        assert!(!path.exists());
    }
}
