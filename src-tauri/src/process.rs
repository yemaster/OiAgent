use std::{ffi::OsStr, process::Command};

/// Background probes and pipe-based tasks must not allocate a Windows console.
/// Interactive terminals use portable_pty instead of this command builder.
pub fn background_command(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: redirects still work; no separate console is created.
        // https://learn.microsoft.com/windows/win32/procthread/process-creation-flags
        command.creation_flags(0x0800_0000);
    }
    // Keep stdin closed for unattended tools, which must never wait for input.
    command.stdin(std::process::Stdio::null());
    command
}

/// Stop the task process and its subprocesses, including Windows command shims.
pub fn terminate_background(child: &mut std::process::Child) {
    if child.try_wait().ok().flatten().is_some() {
        return;
    }
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    terminate_windows_tree(child.id());
    let _ = child.kill();
}

#[cfg(windows)]
pub fn terminate_windows_tree(pid: u32) {
    use std::{
        process::Stdio,
        time::{Duration, Instant},
    };
    let Some(root) = std::env::var_os("SystemRoot") else {
        return;
    };
    let program = std::path::PathBuf::from(root)
        .join("System32")
        .join("taskkill.exe");
    let Ok(mut killer) = background_command(program)
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return;
    };
    let start = Instant::now();
    loop {
        match killer.try_wait() {
            Ok(Some(_)) => break,
            _ if start.elapsed() > Duration::from_secs(5) => {
                let _ = killer.kill();
                let _ = killer.wait();
                break;
            }
            Err(_) => {
                let _ = killer.kill();
                let _ = killer.wait();
                break;
            }
            _ => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Stdio;

    #[test]
    fn background_command_preserves_output_and_exit_status() {
        // Spawn this test executable so the regression is independent of any
        // installed shell, Git, or Agent. The Windows child checks its console.
        let output = background_command(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "process::tests::child_process_probe",
                "--nocapture",
            ])
            .env("OIAGENT_BACKGROUND_PROCESS_PROBE", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(7), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stdout).contains("background stdout"));
        assert!(String::from_utf8_lossy(&output.stderr).contains("background stderr"));
    }

    #[test]
    fn child_process_probe() {
        if std::env::var("OIAGENT_BACKGROUND_PROCESS_PROBE").as_deref() != Ok("1") {
            return;
        }
        #[cfg(windows)]
        {
            #[link(name = "kernel32")]
            extern "system" {
                fn GetConsoleWindow() -> *mut std::ffi::c_void;
            }
            assert!(
                unsafe { GetConsoleWindow() }.is_null(),
                "background process allocated a console"
            );
        }
        println!("background stdout");
        eprintln!("background stderr");
        std::process::exit(7);
    }
}
