//! Shutdown-only process discovery. Never persist environment values or match by program name.
use std::{
    collections::HashMap,
    ffi::OsStr,
    time::{Duration, Instant},
};
use sysinfo::{Pid, ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System, UpdateKind};

pub const OWNER_ENV: &str = "OIAGENT_PROCESS_OWNER";

/// Capture surviving jobs while the launcher still owns the process/group identity.
/// macOS can deny environment access for protected system binaries, so marker scanning alone is insufficient.
pub fn remember_descendants(state: &crate::store::AppState, root: u32, terminal: bool) {
    if root <= 1 || root == std::process::id() {
        return;
    }
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().without_tasks(),
    );
    let mut members = std::collections::HashSet::from([Pid::from_u32(root)]);
    #[cfg(unix)]
    for &pid in system.processes().keys() {
        let member = unsafe {
            libc::getpgid(pid.as_u32() as i32) == root as i32
                || (terminal && libc::getsid(pid.as_u32() as i32) == root as i32)
        };
        if member {
            members.insert(pid);
        }
    }
    #[cfg(not(unix))]
    let _ = terminal;
    loop {
        let previous = members.len();
        for (&pid, process) in system.processes() {
            if process
                .parent()
                .is_some_and(|parent| members.contains(&parent))
            {
                members.insert(pid);
            }
        }
        if previous == members.len() {
            break;
        }
    }
    let mut known = state.owned_process_identities.lock().unwrap();
    known.retain(|pid, started| {
        system
            .process(Pid::from_u32(*pid))
            .is_some_and(|p| p.start_time() == *started)
    });
    for pid in members {
        if pid.as_u32() <= 1 || pid.as_u32() == std::process::id() {
            continue;
        }
        if let Some(process) = system.process(pid) {
            if !matches!(
                process.status(),
                ProcessStatus::Zombie | ProcessStatus::Dead
            ) {
                known.insert(pid.as_u32(), process.start_time());
            }
        }
    }
}

pub struct OwnedProcesses {
    system: System,
    marker: String,
    // A PID alone is not an identity: discard entries when the start time changes.
    known: HashMap<Pid, u64>,
}
impl OwnedProcesses {
    pub fn capture(owner: &str, roots: &[u32]) -> Result<Self, String> {
        let mut this = Self {
            system: System::new(),
            marker: format!("{OWNER_ENV}={owner}"),
            known: HashMap::new(),
        };
        this.refresh()?;
        for &root in roots {
            let pid = Pid::from_u32(root);
            if let Some(process) = this.system.process(pid) {
                if root > 1 && root != std::process::id() {
                    this.known.insert(pid, process.start_time());
                }
            }
        }
        this.discover();
        Ok(this)
    }
    pub fn include_known(&mut self, known: &HashMap<u32, u64>) {
        for (&pid, &started) in known {
            if pid <= 1 || pid == std::process::id() {
                continue;
            }
            let pid = Pid::from_u32(pid);
            if self
                .system
                .process(pid)
                .is_some_and(|p| p.start_time() == started)
            {
                self.known.insert(pid, started);
            }
        }
        self.discover();
    }
    fn refresh(&mut self) -> Result<(), String> {
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .without_tasks()
                .with_environ(UpdateKind::Always),
        );
        if self
            .system
            .process(Pid::from_u32(std::process::id()))
            .is_none()
        {
            return Err("无法读取系统进程，应用尚未退出".into());
        }
        Ok(())
    }
    fn discover(&mut self) {
        self.known.retain(|pid, started| {
            self.system
                .process(*pid)
                .is_some_and(|p| p.start_time() == *started)
        });
        for (&pid, process) in self.system.processes() {
            if pid.as_u32() <= 1 || pid.as_u32() == std::process::id() {
                continue;
            }
            if process
                .environ()
                .iter()
                .any(|entry| entry == OsStr::new(&self.marker))
            {
                self.known.insert(pid, process.start_time());
            }
        }
        // Includes descendants that intentionally clear their environment but still have an owned parent.
        loop {
            let previous = self.known.len();
            for (&pid, process) in self.system.processes() {
                if pid.as_u32() <= 1 || pid.as_u32() == std::process::id() {
                    continue;
                }
                if process
                    .parent()
                    .is_some_and(|parent| self.known.contains_key(&parent))
                {
                    self.known.insert(pid, process.start_time());
                }
            }
            if self.known.len() == previous {
                break;
            }
        }
    }
    pub fn terminate_and_wait(&mut self, timeout: Duration) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        let mut empty_passes = 0;
        loop {
            let live: Vec<_> = self
                .known
                .keys()
                .filter_map(|pid| self.system.process(*pid))
                .filter(|p| !matches!(p.status(), ProcessStatus::Zombie | ProcessStatus::Dead))
                .collect();
            if live.is_empty() {
                empty_passes += 1;
                // Re-scan once more to catch a child spawned immediately before its parent was stopped.
                if empty_passes >= 2 {
                    return Ok(());
                }
            } else {
                empty_passes = 0;
                if Instant::now() >= deadline {
                    return Err(format!(
                        "还有 {} 个 Agent 或终端进程未能停止，请重试退出",
                        live.len()
                    ));
                }
                for process in live {
                    process.kill();
                }
            }
            std::thread::sleep(Duration::from_millis(50));
            self.refresh()?;
            self.discover();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::Path,
        process::{Child, Command, Stdio},
    };
    const PROBE: &str = "OIAGENT_SHUTDOWN_PROBE";
    struct Guard(Child);
    impl Drop for Guard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    fn probe(mode: &str) -> Command {
        let mut command = crate::process::background_command(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "owned_processes::tests::process_probe",
                "--nocapture",
            ])
            .env(PROBE, mode)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        command
    }
    fn wait_file(path: &Path) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Ok(text) = std::fs::read_to_string(path) {
                if let Ok(pid) = text.parse() {
                    return pid;
                }
            }
            assert!(Instant::now() < deadline, "probe did not start");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    #[test]
    fn process_probe() {
        let Ok(mode) = std::env::var(PROBE) else {
            return;
        };
        if mode == "parent" || mode == "cleared-parent" {
            let mut command = probe("child");
            if mode == "cleared-parent" {
                command.env_remove(OWNER_ENV);
            }
            let mut child = command.spawn().unwrap();
            if mode == "parent" {
                std::process::exit(0);
            }
            let _ = child.wait();
            return;
        }
        if let Ok(path) = std::env::var("OIAGENT_SHUTDOWN_PID_FILE") {
            std::fs::write(path, std::process::id().to_string()).unwrap();
        }
        std::thread::sleep(Duration::from_secs(20));
        std::process::exit(0);
    }
    #[test]
    fn shutdown_finds_orphaned_descendants_without_touching_unrelated_processes() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("child.pid");
        let owner = uuid::Uuid::new_v4().to_string();
        let mut other = Guard(probe("child").env_remove(OWNER_ENV).spawn().unwrap());
        let mut parent = Guard(
            probe("parent")
                .env(OWNER_ENV, &owner)
                .env("OIAGENT_SHUTDOWN_PID_FILE", &pid_file)
                .spawn()
                .unwrap(),
        );
        assert!(parent.0.wait().unwrap().success());
        let child = wait_file(&pid_file);
        // No registry root remains; ownership must survive the parent exiting.
        let mut owned = OwnedProcesses::capture(&owner, &[]).unwrap();
        assert!(owned.known.contains_key(&Pid::from_u32(child)));
        owned.terminate_and_wait(Duration::from_secs(5)).unwrap();
        assert!(other.0.try_wait().unwrap().is_none());
        assert!(owned
            .system
            .process(Pid::from_u32(child))
            .is_none_or(|p| matches!(p.status(), ProcessStatus::Zombie | ProcessStatus::Dead)));
    }
    #[test]
    fn shutdown_captures_children_that_clear_the_owner_environment() {
        let dir = tempfile::tempdir().unwrap();
        let pid_file = dir.path().join("child.pid");
        let owner = uuid::Uuid::new_v4().to_string();
        let mut parent = Guard(
            probe("cleared-parent")
                .env(OWNER_ENV, &owner)
                .env("OIAGENT_SHUTDOWN_PID_FILE", &pid_file)
                .spawn()
                .unwrap(),
        );
        let child = wait_file(&pid_file);
        let mut owned = OwnedProcesses::capture(&owner, &[parent.0.id()]).unwrap();
        assert!(owned.known.contains_key(&Pid::from_u32(child)));
        owned.terminate_and_wait(Duration::from_secs(5)).unwrap();
        assert!(parent.0.try_wait().unwrap().is_some());
    }
}
