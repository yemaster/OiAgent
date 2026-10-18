use crate::models::Agent;
use std::{
    path::PathBuf,
    process::Stdio,
    time::{Duration, Instant},
};

pub const BUILTINS: &[(&str, &str)] = &[
    ("codex", "Codex"),
    ("claude", "Claude Code"),
    ("qwen", "Qwen Code"),
    ("qodercn", "Qoder CLI CN"),
    ("gemini", "Gemini CLI"),
    ("opencode", "OpenCode"),
    ("aider", "Aider"),
    ("goose", "Goose"),
];
pub fn builtin(id: &str) -> bool {
    BUILTINS.iter().any(|(kind, _)| *kind == id)
}

pub fn search_paths() -> Vec<PathBuf> {
    let mut paths: Vec<_> =
        std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()).collect();
    if let Some(home) = dirs::home_dir() {
        for dir in [
            ".local/bin",
            ".qoder-cn/entry",
            ".qoder-cn/bin/qoderclicn",
            ".opencode/bin",
            ".cargo/bin",
            ".npm-global/bin",
            ".bun/bin",
            "Library/pnpm",
        ] {
            paths.push(home.join(dir));
        }
        let versions = home.join(".nvm/versions/node");
        if let Ok(entries) = std::fs::read_dir(versions) {
            let mut dirs: Vec<_> = entries.flatten().map(|e| e.path().join("bin")).collect();
            dirs.sort();
            dirs.reverse();
            paths.extend(dirs);
        }
    }
    paths.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"].map(PathBuf::from));
    paths.dedup();
    paths
}
pub fn resolve(executable: &str) -> Option<PathBuf> {
    let p = PathBuf::from(executable);
    if p.is_absolute() {
        return resolve_candidate(p);
    }
    let names = if executable == "qodercn" {
        // Prefer the CLI binary over the CLI/IDE dispatcher when both exist.
        vec!["qoderclicn", "qodercn"]
    } else {
        vec![executable]
    };
    for name in names {
        for dir in search_paths() {
            let candidate = dir.join(name);
            if let Some(candidate) = resolve_candidate(candidate) {
                return Some(candidate);
            }
        }
    }
    None
}
fn resolve_candidate(candidate: PathBuf) -> Option<PathBuf> {
    // npm installs both an extensionless POSIX shell wrapper and a .cmd shim.
    // Windows must not try to execute the POSIX wrapper with CreateProcess.
    #[cfg(windows)]
    if candidate.extension().is_none() {
        for extension in ["exe", "cmd", "bat"] {
            let path = candidate.with_extension(extension);
            if executable_file(&path) {
                return Some(path);
            }
        }
    }
    executable_file(&candidate).then_some(candidate)
}
fn executable_file(p: &std::path::Path) -> bool {
    if !p.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        p.metadata()
            .map(|m| m.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}
pub fn path_env() -> std::ffi::OsString {
    std::env::join_paths(search_paths()).unwrap_or_default()
}
fn version(path: &std::path::Path) -> Result<String, String> {
    let mut command = crate::process::agent_command(path)?;
    command.arg("--version").env("PATH", path_env());
    probe_version(command, Duration::from_secs(3))
}

fn probe_version(mut command: std::process::Command, timeout: Duration) -> Result<String, String> {
    use std::io::{Read, Seek};
    // Files avoid a full stdout/stderr pipe blocking the CLI before it exits.
    // Read a bounded diagnostic; never wait on a pipe inherited by a subprocess.
    let mut stdout = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut stderr = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut child = command
        .stdout(Stdio::from(stdout.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(stderr.try_clone().map_err(|e| e.to_string())?))
        .spawn()
        .map_err(|e| format!("无法启动程序：{e}"))?;
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(30)),
            result => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(match result {
                    Err(error) => format!("读取进程状态失败：{error}"),
                    _ => "版本读取超时".into(),
                });
            }
        }
    };
    fn read(file: &mut std::fs::File) -> Result<String, String> {
        file.rewind().map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(8192)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&bytes).trim().to_owned())
    }
    let out = read(&mut stdout)?;
    let err = read(&mut stderr)?;
    if !status.success() {
        let reason = if err.is_empty() { &out } else { &err };
        return Err(format!(
            "版本命令退出（{}）{}",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "信号".into()),
            if reason.is_empty() {
                String::new()
            } else {
                format!("：{}", reason.chars().take(500).collect::<String>())
            }
        ));
    }
    let text = if out.is_empty() { &err } else { &out };
    if text.is_empty() {
        return Err("版本命令未返回版本信息".into());
    }
    Ok(text
        .lines()
        .next()
        .unwrap_or_default()
        .chars()
        .take(120)
        .collect())
}
pub fn discover(custom: &[Agent]) -> Vec<Agent> {
    let mut agents: Vec<_> = BUILTINS
        .iter()
        .copied()
        .map(|(id, name)| Agent {
            id: id.into(),
            name: name.into(),
            kind: id.into(),
            executable: id.into(),
            args: vec![],
            available: false,
            version: String::new(),
            version_error: None,
            custom: false,
        })
        .collect();
    agents.extend(custom.iter().filter(|a| a.custom).cloned());
    // Probe built-in versions concurrently: a slow CLI must not delay every other one.
    std::thread::scope(|scope| {
        let mut probes = Vec::new();
        for agent in &mut agents {
            if let Some(path) = resolve(&agent.executable) {
                agent.available = true;
                agent.executable = path.to_string_lossy().into();
                if agent.custom {
                    agent.version = "自定义程序".into();
                    agent.version_error = None;
                } else {
                    probes.push(scope.spawn(move || match version(&path) {
                        Ok(version) => {
                            agent.version = version;
                            agent.version_error = None;
                        }
                        Err(error) => {
                            agent.version.clear();
                            agent.version_error = Some(error);
                        }
                    }));
                }
            } else {
                agent.available = false;
                agent.version.clear();
                agent.version_error = None;
            }
        }
        for probe in probes {
            let _ = probe.join();
        }
    });
    agents
}

#[cfg(all(test, windows))]
mod argv_tests {
    use super::*;
    #[test]
    fn windows_prefers_native_then_cmd_over_the_posix_npm_wrapper() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("qwen");
        std::fs::write(&path, "#!/bin/sh").unwrap();
        std::fs::write(path.with_extension("cmd"), "@echo off").unwrap();
        assert_eq!(
            resolve_candidate(path.clone()),
            Some(path.with_extension("cmd"))
        );
        std::fs::write(path.with_extension("exe"), "test fixture").unwrap();
        assert_eq!(
            resolve_candidate(path.clone()),
            Some(path.with_extension("exe"))
        );
    }
}

#[cfg(test)]
mod version_tests {
    use super::*;
    fn node(script: &str) -> std::process::Command {
        let path = resolve(if cfg!(windows) { "node.exe" } else { "node" })
            .expect("Node.js fixture runtime");
        let mut command = crate::process::background_command(path);
        command.args(["-e", script]);
        command
    }
    #[test]
    fn version_probe_handles_stderr_empty_nonzero_exit_and_full_pipes() {
        for (script, expected) in [
            ("console.log('codex-cli 1.2.3')", "codex-cli 1.2.3"),
            ("console.error('2.1.0 (Claude Code)')", "2.1.0 (Claude Code)"),
            ("console.log('1.2.3'); process.stdout.write('x'.repeat(200000)); process.stderr.write('y'.repeat(200000))", "1.2.3"),
        ] {
            assert_eq!(probe_version(node(script), Duration::from_secs(5)).unwrap(), expected);
        }
        let error = probe_version(
            node("console.error('missing dependency'); process.exitCode = 7"),
            Duration::from_secs(5),
        )
        .unwrap_err();
        assert!(error.contains('7') && error.contains("missing dependency"));
        assert!(probe_version(node(""), Duration::from_secs(5))
            .unwrap_err()
            .contains("未返回"));
        assert!(probe_version(
            node("setTimeout(() => {}, 30000)"),
            Duration::from_millis(100)
        )
        .unwrap_err()
        .contains("超时"));
    }
    #[test]
    fn version_probe_preserves_launch_errors_and_old_saved_agents_remain_readable() {
        let root = tempfile::tempdir().unwrap();
        let command = crate::process::background_command(root.path().join("missing-agent.exe"));
        assert!(probe_version(command, Duration::from_secs(1))
            .unwrap_err()
            .contains("无法启动"));
        let agent: Agent = serde_json::from_value(serde_json::json!({"id":"codex","name":"Codex","kind":"codex","executable":"codex","args":[],"available":true,"version":"","custom":false})).unwrap();
        assert!(agent.version_error.is_none());
        assert!(agent.available);
    }
}
