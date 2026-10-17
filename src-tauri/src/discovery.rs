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
fn version(path: &std::path::Path) -> String {
    let Ok(mut command) = crate::process::agent_command(path) else {
        return String::new();
    };
    let Ok(mut child) = command
        .arg("--version")
        .env("PATH", path_env())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    else {
        return String::new();
    };
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                return child
                    .wait_with_output()
                    .ok()
                    .map(|o| {
                        String::from_utf8_lossy(&o.stdout)
                            .trim()
                            .chars()
                            .take(120)
                            .collect()
                    })
                    .unwrap_or_default()
            }
            Ok(None) if start.elapsed() < Duration::from_secs(3) => {
                std::thread::sleep(Duration::from_millis(30))
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return "版本读取超时".into();
            }
        }
    }
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
                } else {
                    probes.push(scope.spawn(move || agent.version = version(&path)));
                }
            } else {
                agent.available = false;
                agent.version.clear();
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
