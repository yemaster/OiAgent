use crate::{history::HistoryCache, models::*};
use std::{
    collections::HashMap,
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
        // Project shells belong to the app session, not conversation history.
        db.tasks.retain(|task| {
            if task.agent_kind != "project-shell" {
                return true;
            }
            let _ = std::fs::remove_file(dir.join("logs").join(format!("{}.pty", task.id)));
            false
        });
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
        std::fs::write(&tmp, serde_json::to_vec(db).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
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
