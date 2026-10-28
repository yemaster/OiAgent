use crate::{history::HistoryCache, models::*};
use std::{
    collections::HashMap,
    io::{BufWriter, Write},
    path::PathBuf,
    process::Child,
    sync::{Arc, Mutex},
};

pub struct AppState {
    pub schedule_lock: Mutex<()>,
    pub supervision_workers: Mutex<std::collections::HashSet<String>>,
    pub ai_runner: Mutex<Option<crate::ai_backend::Runner>>,
    pub live_status: Mutex<HashMap<String, String>>,
    pub title_jobs: Mutex<HashMap<String, crate::task_titles::Job>>,
    pub quotas: crate::quotas::Caches,
    pub process_owner: String,
    pub owned_process_identities: Mutex<HashMap<u32, u64>>,
    pub shutdown_lock: Mutex<()>,
    pub shutdown_complete: std::sync::atomic::AtomicBool,
    pub shutting_down: std::sync::atomic::AtomicBool,
    pub workflow_lock: Mutex<()>,
    pub workflow_workers: Mutex<std::collections::HashSet<String>>,
    pub project_lock: Mutex<()>,
    pub followup_locks: Mutex<HashMap<String, std::sync::Weak<Mutex<()>>>>,
    pub config_lock: Mutex<()>,
    pub terminal_sync: Mutex<()>,
    pub launch_envs: Mutex<HashMap<String, std::collections::BTreeMap<String, String>>>,
    pub db: Mutex<Database>,
    pub dir: PathBuf,
    pub history: Mutex<HistoryCache>,
    pub artifact_logs: Mutex<crate::workflows::artifacts::LogCache>,
    pub llm: Mutex<crate::llm_settings::LlmSettings>,
    pub ptys: Mutex<HashMap<String, crate::terminal::PtySession>>,
    pub approvals: Mutex<HashMap<String, crate::approvals::Session>>,
    pub children: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_complete_json_and_preserves_previous_file_on_write_failure() {
        let dir = tempfile::tempdir().unwrap();
        let state = AppState::load(dir.path().to_owned()).unwrap();
        let mut db = Database::default();
        db.titles
            .insert("example".into(), "中文\n\t🧑‍💻".repeat(16000));
        state.save(&db).unwrap();
        let expected = serde_json::to_vec(&db).unwrap();
        assert_eq!(
            std::fs::read(dir.path().join("state.json")).unwrap(),
            expected
        );
        let loaded = AppState::load(dir.path().to_owned()).unwrap();
        assert_eq!(loaded.db.lock().unwrap().titles, db.titles);
        std::fs::create_dir(dir.path().join("state.json.tmp")).unwrap();
        db.titles.clear();
        assert!(state.save(&db).is_err());
        assert_eq!(
            std::fs::read(dir.path().join("state.json")).unwrap(),
            expected
        );
    }
}
impl AppState {
    pub fn load(dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(dir.join("logs")).map_err(|e| e.to_string())?;
        let path = dir.join("state.json");
        let mut db: Database = if path.exists() {
            serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| format!("本地数据库损坏，原文件已保留：{e}"))?
        } else {
            Database::default()
        };
        // Project shells belong to the app session, not conversation history. AI-assist runs
        // are normally removed when they finish; a crash mid-run leaves hidden leftovers.
        db.tasks.retain(|task| {
            let suffixes: &[&str] = if task.agent_kind == "project-shell" {
                &["pty"]
            } else if task.source == "internal" {
                &["jsonl", "messages.jsonl"]
            } else {
                return true;
            };
            for suffix in suffixes {
                let _ =
                    std::fs::remove_file(dir.join("logs").join(format!("{}.{suffix}", task.id)));
            }
            db.titles.remove(&task.id);
            false
        });
        // Their temporary work directories are only stale once no instance could still use them.
        if let Ok(entries) = std::fs::read_dir(dir.join("ai-work")) {
            let stale = std::time::Duration::from_secs(24 * 60 * 60);
            for entry in entries.flatten() {
                if entry
                    .metadata()
                    .and_then(|m| m.modified())
                    .is_ok_and(|t| t.elapsed().is_ok_and(|age| age > stale))
                {
                    let _ = std::fs::remove_dir_all(entry.path());
                }
            }
        }
        crate::project_paths::normalize_database(&mut db);
        for task in &mut db.tasks {
            if matches!(task.status.as_str(), "running" | "waiting" | "stopping") {
                task.status = "interrupted".into();
                task.preview = "应用已重启，上次任务未确认完成。可重新运行。".into();
            }
        }
        crate::workflows::recover(&mut db, &dir);
        crate::schedules::recover(&mut db);
        Ok(Self {
            schedule_lock: Mutex::new(()),
            supervision_workers: Mutex::new(Default::default()),
            ai_runner: Mutex::new(None),
            live_status: Mutex::new(HashMap::new()),
            title_jobs: Mutex::new(HashMap::new()),
            quotas: Default::default(),
            artifact_logs: Default::default(),
            process_owner: uuid::Uuid::new_v4().to_string(),
            owned_process_identities: Mutex::new(HashMap::new()),
            shutdown_lock: Mutex::new(()),
            shutdown_complete: std::sync::atomic::AtomicBool::new(false),
            shutting_down: std::sync::atomic::AtomicBool::new(false),
            workflow_lock: Mutex::new(()),
            workflow_workers: Mutex::new(Default::default()),
            project_lock: Mutex::new(()),
            followup_locks: Mutex::new(HashMap::new()),
            config_lock: Mutex::new(()),
            terminal_sync: Mutex::new(()),
            launch_envs: Mutex::new(HashMap::new()),
            llm: Mutex::new(Default::default()),
            ptys: Mutex::new(HashMap::new()),
            db: Mutex::new(db),
            history: Mutex::new(HistoryCache::with_disk_cache(
                dir.join("history-index.json"),
            )),
            dir,
            children: Mutex::new(HashMap::new()),
            approvals: Mutex::new(HashMap::new()),
        })
    }
    pub fn save(&self, db: &Database) -> Result<(), String> {
        let tmp = self.dir.join("state.json.tmp");
        // Stream into the temporary file instead of allocating a second copy of
        // the entire database. Close the writer before replacing it on Windows.
        {
            let file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
            let mut writer = BufWriter::new(file);
            serde_json::to_writer(&mut writer, db).map_err(|e| e.to_string())?;
            writer.flush().map_err(|e| e.to_string())?;
        }
        std::fs::rename(tmp, self.dir.join("state.json")).map_err(|e| e.to_string())
    }
    pub fn update(&self, id: &str, f: impl FnOnce(&mut Task)) -> Result<Task, String> {
        let mut db = self.db.lock().map_err(|e| e.to_string())?;
        let t = db
            .tasks
            .iter_mut()
            .find(|t| t.id == id)
            .ok_or("任务不存在")?;
        f(t);
        t.updated_at = now();
        let t = t.clone();
        self.save(&db)?;
        Ok(t)
    }
    pub fn log_path(&self, id: &str) -> PathBuf {
        self.dir.join("logs").join(format!("{id}.jsonl"))
    }
}
