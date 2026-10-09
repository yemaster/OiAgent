use crate::{history::HistoryCache, models::*};
use std::{
    collections::HashMap,
    path::PathBuf,
    process::Child,
    sync::{Arc, Mutex},
};

pub struct AppState {
    pub project_lock: Mutex<()>,
    pub config_lock: Mutex<()>,
    pub terminal_sync: Mutex<()>,
    pub launch_envs: Mutex<HashMap<String, std::collections::BTreeMap<String, String>>>,
    pub db: Mutex<Database>,
    pub dir: PathBuf,
    pub history: Mutex<HistoryCache>,
    pub llm: Mutex<crate::llm_settings::LlmSettings>,
    pub ptys: Mutex<HashMap<String, crate::terminal::PtySession>>,
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
        for task in &mut db.tasks {
            if task.status == "running" {
                task.status = "interrupted".into();
                task.preview = "应用已重启，上次任务未确认完成。可重新运行。".into();
            }
        }
        Ok(Self {
            project_lock: Mutex::new(()),
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
