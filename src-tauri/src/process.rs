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
