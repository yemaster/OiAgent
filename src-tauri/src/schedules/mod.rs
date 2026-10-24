#[cfg(test)]
mod tests;
mod timing;
use crate::{
    models::{Database, Task, TaskInput},
    runtime,
    store::AppState,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager};
pub use timing::Rule;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Target {
    Agent {
        agent_id: String,
        prompt: String,
        permission: String,
        model: String,
        provider_id: Option<String>,
    },
    Workflow {
        workflow_id: String,
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub revision: u64,
    pub name: String,
    pub project: String,
    pub target: Target,
    pub rule: Rule,
    pub enabled: bool,
    /// Skip by default; optionally coalesce all missed occurrences into one run.
    #[serde(default)]
    pub catch_up: bool,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub scheduled_at: String,
    pub started_at: String,
    pub trigger: String,
    pub status: String,
    pub message: String,
    pub task_id: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub definition: Definition,
    pub next_run_at: Option<String>,
    pub runs: Vec<Run>,
}
fn active(status: &str) -> bool {
    matches!(
        status,
        "starting" | "queued" | "running" | "waiting" | "stopping"
    )
}
fn transaction<T>(
    state: &AppState,
    f: impl FnOnce(&mut Database) -> Result<T, String>,
) -> Result<T, String> {
    let mut db = state.db.lock().map_err(|e| e.to_string())?;
    let mut next = db.clone();
    let result = f(&mut next)?;
    state.save(&next)?;
    *db = next;
    Ok(result)
}
fn validate(def: &Definition, db: &Database) -> Result<(), String> {
    if def.name.trim().is_empty() || def.name.len() > 240 {
        return Err("请填写名称（最多 240 字节）".into());
    }
    def.rule.validate()?;
    if db
        .temporary_projects
        .iter()
        .any(|p| crate::temporary_projects::contains(&p.path, &def.project))
    {
        return Err("定时任务请选择固定项目目录".into());
    }
    match &def.target {
        Target::Agent {
            agent_id,
            prompt,
            permission,
            model,
            provider_id,
        } => {
            if prompt.trim().is_empty() || prompt.len() > 64000 || model.len() > 240 {
                return Err("请填写任务内容（最多 64 KB）".into());
            }
            if crate::commands::slash(prompt).is_some() {
                return Err("定时任务请填写任务内容，不支持会话控制命令".into());
            }
            let agent = db
                .agents
                .iter()
                .find(|a| &a.id == agent_id && a.available)
                .ok_or("Agent 不可用，请重新选择")?;
            crate::launch::permission(&agent.kind, permission)?;
            if let Some(id) = provider_id {
                if agent.kind != "claude" || !db.providers.iter().any(|p| &p.id == id) {
                    return Err("Claude Code API 配置不可用".into());
                }
            }
        }
        Target::Workflow { workflow_id } => {
            let definition = db
                .workflow_definitions
                .iter()
                .find(|d| &d.id == workflow_id && !db.archived_workflows.contains(&d.id))
                .ok_or("工作流已删除或归档")?;
            crate::workflows::validate(definition, db, true)?;
        }
    }
    Ok(())
}
fn reconcile(db: &mut Database, restarting: bool) -> bool {
    let tasks: std::collections::HashMap<_, _> =
        db.tasks.iter().map(|t| (t.id.as_str(), t)).collect();
    let mut changed = false;
    for schedule in &mut db.schedules {
        for run in &mut schedule.runs {
            let before = (run.status.clone(), run.message.clone());
            if let Some(task) = run.task_id.as_ref().and_then(|id| tasks.get(id.as_str())) {
                // A durable claim with an unlaunched queued task must never replay after a crash.
                if task.status == "queued" && active(&run.status) {
                    if !restarting {
                        continue;
                    }
                    run.status = "interrupted".into();
                    run.message = "应用在启动任务时退出，本次未自动重试".into();
                } else {
                    run.status = task.status.clone();
                    if run.status != "failed" {
                        run.message.clear();
                    }
                    if matches!(task.status.as_str(), "failed" | "interrupted") {
                        run.message = task.preview.clone();
                    }
                }
            } else if restarting && active(&run.status) {
                run.status = "interrupted".into();
                run.message = "应用在启动任务时退出，本次未自动重试".into();
                run.task_id = None;
            } else if run.task_id.is_some() && run.status != "starting" {
                run.task_id = None;
                if run.message.is_empty() {
                    run.message = "任务记录已删除".into();
                }
            }
            changed |= before != (run.status.clone(), run.message.clone());
        }
    }
    changed
}
pub fn recover(db: &mut Database) {
    reconcile(db, true);
    // Queued tasks are not resumed implicitly by the scheduler.
    let ids: std::collections::HashSet<_> = db
        .schedules
        .iter()
        .flat_map(|s| &s.runs)
        .filter(|r| r.status == "interrupted")
        .filter_map(|r| r.task_id.as_ref())
        .cloned()
        .collect();
    for task in &mut db.tasks {
        if ids.contains(&task.id) && task.status == "queued" {
            task.status = "interrupted".into();
            task.preview = "定时任务启动中断，可手动重新运行".into();
        }
    }
}
#[tauri::command]
pub fn schedule_catalog(state: tauri::State<AppState>) -> Vec<Schedule> {
    state.db.lock().unwrap().schedules.clone()
}
#[tauri::command]
pub fn preview_schedule(rule: Rule) -> Result<Vec<String>, String> {
    rule.validate()?;
    let mut after = Utc::now();
    let mut times = vec![];
    for _ in 0..3 {
        let Some(next) = rule.next(after, None) else {
            break;
        };
        times.push(next.to_rfc3339());
        after = next;
    }
    Ok(times)
}
#[tauri::command]
pub fn save_schedule(
    app: tauri::AppHandle,
    mut definition: Definition,
) -> Result<Schedule, String> {
    let state = app.state::<AppState>();
    let _gate = state.schedule_lock.lock().map_err(|e| e.to_string())?;
    let path = dunce::canonicalize(definition.project.trim()).map_err(|_| "项目目录不存在")?;
    if !path.is_dir() {
        return Err("请选择项目文件夹".into());
    }
    definition.project = path.to_string_lossy().into();
    definition.name = definition.name.trim().into();
    let saved = transaction(&state, |db| {
        validate(&definition, db)?;
        let old = db
            .schedules
            .iter()
            .position(|s| s.definition.id == definition.id);
        if !definition.id.is_empty() && old.is_none() {
            return Err("定时任务已删除".into());
        }
        if let Some(i) = old {
            if db.schedules[i].definition.revision != definition.revision {
                return Err("配置已更新，请重新打开后编辑".into());
            }
        } else if db.schedules.len() >= 100 {
            return Err("最多保存 100 个定时任务".into());
        }
        let unchanged = old.is_some_and(|i| {
            db.schedules[i].definition.rule == definition.rule
                && db.schedules[i].definition.enabled == definition.enabled
        });
        let next = if !definition.enabled {
            None
        } else if unchanged {
            db.schedules[old.unwrap()].next_run_at.clone()
        } else {
            Some(
                definition
                    .rule
                    .next(Utc::now(), None)
                    .ok_or("执行时间已过，请重新选择")?
                    .to_rfc3339(),
            )
        };
        if definition.id.is_empty() {
            definition.id = uuid::Uuid::new_v4().to_string();
        }
        definition.revision += 1;
        let saved = Schedule {
            definition,
            next_run_at: next,
            runs: old
                .map(|i| db.schedules[i].runs.clone())
                .unwrap_or_default(),
        };
        if let Some(i) = old {
            db.schedules[i] = saved.clone();
        } else {
            db.schedules.push(saved.clone());
        }
        Ok(saved)
    })?;
    let _ = app.emit("schedules-changed", ());
    Ok(saved)
}
#[tauri::command]
pub fn set_schedule_enabled(
    app: tauri::AppHandle,
    id: String,
    revision: u64,
    enabled: bool,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _gate = state.schedule_lock.lock().map_err(|e| e.to_string())?;
    transaction(&state, |db| {
        let item = db
            .schedules
            .iter_mut()
            .find(|s| s.definition.id == id)
            .ok_or("定时任务不存在")?;
        if item.definition.revision != revision {
            return Err("配置已更新，请刷新后重试".into());
        }
        item.next_run_at = if enabled {
            Some(
                item.definition
                    .rule
                    .next(Utc::now(), None)
                    .ok_or("执行时间已过，请编辑执行时间")?
                    .to_rfc3339(),
            )
        } else {
            None
        };
        item.definition.enabled = enabled;
        item.definition.revision += 1;
        Ok(())
    })?;
    let _ = app.emit("schedules-changed", ());
    Ok(())
}
#[tauri::command]
pub fn remove_schedule(app: tauri::AppHandle, id: String, revision: u64) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _gate = state.schedule_lock.lock().map_err(|e| e.to_string())?;
    transaction(&state, |db| {
        let item = db
            .schedules
            .iter()
            .find(|s| s.definition.id == id)
            .ok_or("定时任务不存在")?;
        if item.definition.revision != revision {
            return Err("配置已更新，请刷新后重试".into());
        }
        if item.runs.iter().any(|r| r.status == "starting") {
            return Err("任务正在启动，请稍后再删除".into());
        }
        db.schedules.retain(|s| s.definition.id != id);
        Ok(())
    })?;
    let _ = app.emit("schedules-changed", ());
    Ok(())
}
#[derive(Clone)]
struct Claim {
    definition: Definition,
    run_id: String,
}
fn claim(
    db: &mut Database,
    id: &str,
    now: DateTime<Utc>,
    manual: bool,
) -> Result<Option<Claim>, String> {
    reconcile(db, false);
    let schedule = db
        .schedules
        .iter_mut()
        .find(|s| s.definition.id == id)
        .ok_or("定时任务不存在")?;
    let due = if manual {
        now
    } else {
        if !schedule.definition.enabled {
            return Ok(None);
        }
        let Some(due) = schedule
            .next_run_at
            .as_deref()
            .and_then(|s| s.parse::<DateTime<Utc>>().ok())
        else {
            return Ok(None);
        };
        if due > now {
            return Ok(None);
        }
        due
    };
    let busy = schedule.runs.iter().any(|r| active(&r.status));
    if manual && busy {
        return Err("上一轮尚未结束，请先处理或停止任务".into());
    }
    if !manual {
        schedule.next_run_at = schedule
            .definition
            .rule
            .next(now, Some(due))
            .map(|t| t.to_rfc3339());
        if matches!(schedule.definition.rule, Rule::Once { .. }) {
            schedule.definition.enabled = false;
            schedule.definition.revision += 1;
        }
    }
    let skipped = if busy {
        Some("上一轮尚未结束")
    } else if !manual && !schedule.definition.catch_up && (now - due).num_seconds() > 60 {
        Some("已错过执行时间")
    } else {
        None
    };
    let id = uuid::Uuid::new_v4().to_string();
    schedule.runs.insert(
        0,
        Run {
            id: id.clone(),
            scheduled_at: due.to_rfc3339(),
            started_at: now.to_rfc3339(),
            trigger: if manual { "manual" } else { "schedule" }.into(),
            status: if skipped.is_some() {
                "skipped"
            } else {
                "starting"
            }
            .into(),
            message: skipped.unwrap_or_default().into(),
            task_id: skipped.is_none().then(|| id.clone()),
        },
    );
    // Keep active records even when a long-running task skips many occurrences.
    let mut finished = 0;
    schedule.runs.retain(|r| {
        if active(&r.status) {
            true
        } else {
            finished += 1;
            finished <= 50
        }
    });
    Ok(skipped.is_none().then(|| Claim {
        definition: schedule.definition.clone(),
        run_id: id,
    }))
}
fn execute<R: tauri::Runtime>(app: &tauri::AppHandle<R>, claim: Claim) -> Result<Task, String> {
    let state = app.state::<AppState>();
    let result = (|| {
        if state.shutting_down.load(Ordering::Acquire) {
            return Err("应用正在退出".into());
        }
        {
            let db = state.db.lock().map_err(|e| e.to_string())?;
            validate(&claim.definition, &db)?;
        }
        match &claim.definition.target {
            Target::Agent {
                agent_id,
                prompt,
                permission,
                model,
                provider_id,
            } => {
                let input = TaskInput {
                    title: claim.definition.name.clone(),
                    project: claim.definition.project.clone(),
                    prompt: prompt.clone(),
                    agent_id: agent_id.clone(),
                    permission: permission.clone(),
                    model: model.clone(),
                    provider_id: provider_id.clone(),
                    attachments: vec![],
                    extra_args: vec![],
                    env: Default::default(),
                    queued: false,
                    resume_session: None,
                };
                let task = runtime::create_scheduled(&state, input, claim.run_id.clone())?;
                runtime::emit(app, &task);
                runtime::start(app.clone(), task.id)
            }
            Target::Workflow { workflow_id } => {
                let definition = state
                    .db
                    .lock()
                    .map_err(|e| e.to_string())?
                    .workflow_definitions
                    .iter()
                    .find(|d| &d.id == workflow_id)
                    .cloned()
                    .ok_or("工作流不存在")?;
                crate::workflows::start_scheduled(
                    app.clone(),
                    definition,
                    claim.definition.project.clone(),
                    Some(claim.run_id.clone()),
                )
            }
        }
    })();
    transaction(&state, |db| {
        if let Some(error) = result.as_ref().err() {
            if let Some(task) = db
                .tasks
                .iter_mut()
                .find(|t| t.id == claim.run_id && t.status == "queued")
            {
                task.status = "failed".into();
                task.preview = error.clone();
            }
        }
        let task_exists = db.tasks.iter().any(|t| t.id == claim.run_id);
        if let Some(run) = db
            .schedules
            .iter_mut()
            .find(|s| s.definition.id == claim.definition.id)
            .and_then(|s| s.runs.iter_mut().find(|r| r.id == claim.run_id))
        {
            match &result {
                Ok(task) => {
                    run.status = task.status.clone();
                }
                Err(error) => {
                    run.status = "failed".into();
                    run.message = error.clone();
                    if !task_exists {
                        run.task_id = None;
                    }
                }
            }
        }
        Ok(())
    })?;
    let _ = app.emit("schedules-changed", ());
    if let Some(task) = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .find(|t| t.id == claim.run_id)
        .cloned()
    {
        runtime::emit(app, &task);
    }
    result
}
#[tauri::command]
pub async fn run_schedule(app: tauri::AppHandle, id: String) -> Result<Task, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let claimed = {
            let _gate = state.schedule_lock.lock().map_err(|e| e.to_string())?;
            if state.shutting_down.load(Ordering::Acquire) {
                return Err("应用正在退出".into());
            }
            transaction(&state, |db| claim(db, &id, Utc::now(), true))?.ok_or("无法启动定时任务")?
        };
        let _ = app.emit("schedules-changed", ());
        execute(&app, claimed)
    })
    .await
    .map_err(|e| e.to_string())?
}
fn tick<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let claims = {
        let _gate = state.schedule_lock.lock().map_err(|e| e.to_string())?;
        if state.shutting_down.load(Ordering::Acquire) {
            return Ok(());
        }
        let now = Utc::now();
        let mut db = state.db.lock().map_err(|e| e.to_string())?;
        if db.schedules.is_empty() {
            return Ok(());
        }
        // No persistence or database clone while nothing changes.
        let due: Vec<_> = db
            .schedules
            .iter()
            .filter(|s| {
                s.definition.enabled
                    && s.next_run_at
                        .as_deref()
                        .and_then(|s| s.parse::<DateTime<Utc>>().ok())
                        .is_some_and(|t| t <= now)
            })
            .map(|s| s.definition.id.clone())
            .collect();
        let tasks: std::collections::HashMap<_, _> =
            db.tasks.iter().map(|t| (t.id.as_str(), t)).collect();
        let needs_sync = db.schedules.iter().flat_map(|s| &s.runs).any(|r| {
            r.task_id
                .as_ref()
                .is_some_and(|id| match tasks.get(id.as_str()) {
                    Some(t) => t.status != r.status,
                    None => r.status != "starting",
                })
        });
        if due.is_empty() && !needs_sync {
            return Ok(());
        }
        let mut next = db.clone();
        reconcile(&mut next, false);
        let mut claims = vec![];
        for id in due {
            if let Some(c) = claim(&mut next, &id, now, false)? {
                claims.push(c);
            }
        }
        // Consume occurrences before launching. A crash cannot replay an already claimed run.
        state.save(&next)?;
        *db = next;
        claims
    };
    let _ = app.emit("schedules-changed", ());
    for claimed in claims {
        let _ = execute(app, claimed);
    }
    Ok(())
}
pub fn install<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let app = app.clone();
    std::thread::spawn(move || {
        while !app
            .state::<AppState>()
            .shutdown_complete
            .load(Ordering::Acquire)
        {
            if let Err(error) = tick(&app) {
                eprintln!("定时任务调度失败：{error}");
            }
            std::thread::sleep(std::time::Duration::from_secs(10));
        }
    });
}
