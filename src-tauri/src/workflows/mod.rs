mod engine;
mod prompts;
#[cfg(test)]
mod tests;
use crate::{models::*, runtime, store::AppState, supervisor};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub prompt: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default = "read_only")]
    pub permission: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub provider_id: Option<String>,
    // Old timeoutMinutes values were implicit defaults, not user opt-ins.
    // Use a new field so existing workflows become unlimited on upgrade.
    #[serde(default)]
    pub execution_timeout_minutes: Option<u32>,
    #[serde(default)]
    pub max_repairs: u32,
}
fn read_only() -> String {
    "read-only".into()
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Definition {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub revision: u64,
    pub name: String,
    pub goal: String,
    pub steps: Vec<Step>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StepState {
    pub status: String,
    pub task_ids: Vec<String>,
    pub output: String,
    pub attempts: u32,
    pub repairs: u32,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub definition: Definition,
    pub project: String,
    pub status: String,
    pub cursor: usize,
    pub steps: Vec<StepState>,
    pub pause_requested: bool,
    pub error: String,
    pub feedback: String,
    pub revision: u64,
    pub created_at: String,
    pub updated_at: String,
    pub llm_usage: Usage,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    definitions: Vec<Definition>,
}

pub(super) fn transaction<T>(
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
pub fn validate(
    definition: &Definition,
    db: &Database,
    require_available: bool,
) -> Result<(), String> {
    if definition.name.trim().is_empty()
        || definition.name.len() > 240
        || definition.goal.trim().is_empty()
        || definition.goal.len() > 32000
    {
        return Err("请填写工作流名称和目标（名称最多 240 字节，目标最多 32 KB）".into());
    }
    if definition.steps.is_empty() || definition.steps.len() > 24 {
        return Err("工作流需要 1–24 个步骤".into());
    }
    let mut ids = HashSet::new();
    for (index, step) in definition.steps.iter().enumerate() {
        if step.id.is_empty()
            || step.id.len() > 80
            || !ids.insert(&step.id)
            || step.title.trim().is_empty()
            || step.title.len() > 240
            || step.prompt.trim().is_empty()
            || step.prompt.len() > 32000
        {
            return Err(format!("第 {} 步的名称、内容或标识无效", index + 1));
        }
        if step.execution_timeout_minutes == Some(0) {
            return Err("执行时限需为正整数（分钟），留空不限制".into());
        }
        if step.max_repairs > 2 {
            return Err("自动返工最多 2 次".into());
        }
        match step.kind.as_str() {
            "agent" => {
                if !["read-only", "workspace-write"].contains(&step.permission.as_str()) {
                    return Err("工作流仅支持只读或项目可写权限".into());
                }
                let agent = db
                    .agents
                    .iter()
                    .find(|a| {
                        a.id == step.agent_id && !a.custom && (!require_available || a.available)
                    })
                    .ok_or("步骤中的 Agent 不可用，请重新选择".to_string())?;
                crate::launch::permission(&agent.kind, &step.permission)?;
                if let Some(provider) = &step.provider_id {
                    if agent.kind != "claude" || !db.providers.iter().any(|p| &p.id == provider) {
                        return Err("步骤中的 Claude Code API 配置不可用".into());
                    }
                }
                if step.max_repairs != 0 {
                    return Err("返工次数只用于 LLM 检查步骤".into());
                }
            }
            "approval" => {
                if step.max_repairs != 0 {
                    return Err("人工确认步骤不能自动返工".into());
                }
            }
            "review" => {
                if index == 0
                    || (step.max_repairs > 0 && definition.steps[index - 1].kind != "agent")
                {
                    return Err("LLM 检查需要前序结果，自动返工须紧跟 Agent 步骤".into());
                }
            }
            _ => return Err("未知工作流步骤类型".into()),
        }
    }
    Ok(())
}
#[tauri::command]
pub fn workflow_catalog(state: tauri::State<AppState>) -> Catalog {
    Catalog {
        definitions: state.db.lock().unwrap().workflow_definitions.clone(),
    }
}
#[tauri::command]
pub fn save_workflow(
    state: tauri::State<AppState>,
    mut definition: Definition,
) -> Result<Definition, String> {
    transaction(&state, |db| {
        validate(&definition, db, false)?;
        if definition.id.is_empty() {
            definition.id = uuid::Uuid::new_v4().to_string();
            definition.revision = 1;
            db.workflow_definitions.push(definition.clone());
        } else {
            let current = db
                .workflow_definitions
                .iter_mut()
                .find(|d| d.id == definition.id)
                .ok_or("工作流已删除")?;
            if current.revision != definition.revision {
                return Err("工作流已修改，请重新打开后编辑".into());
            }
            definition.revision += 1;
            *current = definition.clone();
        }
        Ok(definition)
    })
}
#[tauri::command]
pub fn remove_workflow(
    state: tauri::State<AppState>,
    id: String,
    revision: u64,
) -> Result<(), String> {
    transaction(&state, |db| {
        let current = db
            .workflow_definitions
            .iter()
            .find(|d| d.id == id)
            .ok_or("工作流不存在")?;
        if current.revision != revision {
            return Err("工作流已修改，请刷新后重试".into());
        }
        db.workflow_definitions.retain(|d| d.id != id);
        Ok(())
    })
}
pub(super) fn get(state: &AppState, id: &str) -> Result<Run, String> {
    state
        .db
        .lock()
        .unwrap()
        .workflow_runs
        .iter()
        .find(|r| r.id == id)
        .cloned()
        .ok_or("找不到工作流运行记录".into())
}
#[tauri::command]
pub fn workflow_run(state: tauri::State<AppState>, id: String) -> Result<Run, String> {
    get(&state, &id)
}
#[tauri::command]
pub async fn generate_workflow(
    app: tauri::AppHandle,
    goal: String,
    name: String,
) -> Result<Definition, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        if goal.trim().is_empty() || goal.len() > 32000 {
            return Err("请输入目标，最多 32 KB".into());
        }
        let agents: Vec<_> = state
            .db
            .lock()
            .unwrap()
            .agents
            .iter()
            .filter(|a| a.available && !a.custom)
            .map(|a| serde_json::json!({"id": a.id, "name": a.name, "kind": a.kind}))
            .collect();
        if agents.is_empty() {
            return Err("请先安装一个支持的 Agent".into());
        }
        let config = crate::llm_settings::config(&state)?;
        let system = prompts::planner(&serde_json::json!(agents));
        let (text, _) = supervisor::request(&config, &system, &goal)?;
        let definition = prompts::decode(&text, &goal, &name, &state.db.lock().unwrap());
        definition
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn start_workflow(
    app: tauri::AppHandle,
    definition: Definition,
    project: String,
) -> Result<Task, String> {
    start(app, definition, project)
}
pub fn start<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    definition: Definition,
    project: String,
) -> Result<Task, String> {
    let state = app.state::<AppState>();
    let _gate = state.workflow_lock.lock().unwrap();
    let _project = state.project_lock.lock().unwrap();
    let project = std::fs::canonicalize(project).map_err(|_| "项目目录不存在")?;
    if !project.is_dir() {
        return Err("请选择项目文件夹".into());
    }
    if definition.steps.iter().any(|s| s.kind == "review") {
        crate::llm_settings::config(&state)?;
    }
    let permission = if definition
        .steps
        .iter()
        .any(|step| step.kind == "agent" && step.permission == "workspace-write")
    {
        "workspace-write"
    } else {
        "read-only"
    };
    let project = project.to_string_lossy().into_owned();
    let id = uuid::Uuid::new_v4().to_string();
    let time = now();
    let task: Task = serde_json::from_value(serde_json::json!({"id": id, "title": definition.name, "prompt": definition.goal, "project": project, "agentId":"supervisor", "agentKind":"supervisor", "status":"running", "createdAt":time, "updatedAt":time, "preview":"工作流已启动", "usage":Usage::default(), "sessionId":null, "source":"workflow", "model":"按步骤配置", "permission":permission, "exitCode":null})).map_err(|e| e.to_string())?;
    transaction(&state, |db| {
        validate(&definition, db, true)?;
        crate::temporary_projects::check_available(db, &project)?;
        db.workflow_runs.push(Run {
            id: id.clone(),
            project: project.clone(),
            steps: definition
                .steps
                .iter()
                .map(|_| StepState {
                    status: "pending".into(),
                    ..Default::default()
                })
                .collect(),
            definition,
            status: "running".into(),
            cursor: 0,
            pause_requested: false,
            error: String::new(),
            feedback: String::new(),
            revision: 1,
            created_at: time.clone(),
            updated_at: time,
            llm_usage: Usage::default(),
        });
        db.tasks.push(task.clone());
        if !db.projects.contains(&project) {
            db.projects.push(project);
        }
        crate::temporary_projects::update_expiry(db, chrono::Utc::now());
        Ok(())
    })?;
    runtime::append_message(&state, &id, "user", &task.prompt);
    runtime::emit(&app, &task);
    engine::spawn(app.clone(), &id)?;
    Ok(task)
}
#[tauri::command]
pub fn control_workflow(
    app: tauri::AppHandle,
    id: String,
    action: String,
    revision: u64,
    feedback: String,
) -> Result<Run, String> {
    control(&app, &id, &action, revision, &feedback)
}
pub fn control<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    action: &str,
    revision: u64,
    feedback: &str,
) -> Result<Run, String> {
    let state = app.state::<AppState>();
    let _gate = state.workflow_lock.lock().unwrap();
    if feedback.len() > 8000 {
        return Err("补充说明最多 8 KB".into());
    }
    let previous = get(&state, id)?;
    if previous.revision != revision && !["cancel", "pause"].contains(&action) {
        return Err("运行状态已更新，请稍后重试".into());
    }
    if ["completed", "cancelled"].contains(&previous.status.as_str()) {
        return Err("此运行已经结束".into());
    }
    let resume = ["resume", "approve", "retry", "repair"].contains(&action);
    if resume && state.workflow_workers.lock().unwrap().contains(id) {
        return Err("执行器正在收尾，请稍后重试".into());
    }
    if resume {
        crate::temporary_projects::check_available(&state.db.lock().unwrap(), &previous.project)?;
    }
    if resume {
        let children: Vec<_> = state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .filter(|t| t.parent_id.as_deref() == Some(id))
            .cloned()
            .collect();
        if children.iter().any(|t| t.status == "running") {
            return Err("子任务仍在运行，请等待其结束或先停止，避免重复执行".into());
        }
        // A crash or launch failure can leave a queued attempt. Cancel it before
        // creating a retry, so it cannot be launched later as a second copy.
        for child in children.iter().filter(|t| t.status == "queued") {
            runtime::cancel(app, &child.id)?;
        }
    }
    let mut next = previous.clone();
    match action {
        "pause" if next.status == "running" => {
            if state.workflow_workers.lock().unwrap().contains(id) {
                next.pause_requested = true;
            } else {
                next.status = "waiting".into();
                next.error = "执行器已停止，请检查当前步骤后继续。".into();
                if let Some(step) = next.steps.get_mut(next.cursor) {
                    if step.status == "running" {
                        step.status = "failed".into();
                    }
                }
            }
        }
        "cancel" => {
            next.status = "cancelled".into();
            next.error = "工作流已停止".into();
            if let Some(step) = next.steps.get_mut(next.cursor) {
                step.status = "cancelled".into();
                step.finished_at = Some(now());
            }
        }
        "resume"
            if next.status == "waiting"
                && next
                    .steps
                    .get(next.cursor)
                    .is_none_or(|s| s.status == "pending") =>
        {
            next.status = "running".into();
        }
        "approve"
            if next.status == "waiting"
                && next
                    .steps
                    .get(next.cursor)
                    .is_some_and(|s| s.status == "approval") =>
        {
            next.steps[next.cursor].status = "completed".into();
            next.steps[next.cursor].output = if feedback.trim().is_empty() {
                "用户已确认".into()
            } else {
                format!("用户已确认：{feedback}")
            };
            next.steps[next.cursor].finished_at = Some(now());
            next.cursor += 1;
            next.status = "running".into();
        }
        "retry"
            if next.status == "waiting"
                && next
                    .steps
                    .get(next.cursor)
                    .is_some_and(|s| s.status == "failed") =>
        {
            if next.steps[next.cursor].attempts >= 10 {
                return Err("当前步骤已执行 10 次，请复制工作流后重新检查配置".into());
            }
            next.steps[next.cursor].status = "pending".into();
            next.status = "running".into();
        }
        "repair"
            if next.status == "waiting"
                && next.cursor > 0
                && next.steps[next.cursor].status == "failed"
                && next.definition.steps[next.cursor].kind == "review"
                && next.definition.steps[next.cursor - 1].kind == "agent" =>
        {
            if next.steps[next.cursor - 1].attempts >= 10 || next.steps[next.cursor].attempts >= 10
            {
                return Err("返工次数已达上限，请新建运行".into());
            }
            next.steps[next.cursor].status = "pending".into();
            next.cursor -= 1;
            next.steps[next.cursor].status = "pending".into();
            next.status = "running".into();
        }
        _ => return Err("当前状态不支持此操作".into()),
    }
    if resume {
        next.pause_requested = false;
        next.error.clear();
        if !feedback.trim().is_empty() {
            next.feedback = feedback.into();
        }
    }
    engine::save_run(app, next)?;
    if action == "cancel" {
        let children: Vec<_> = state
            .db
            .lock()
            .unwrap()
            .tasks
            .iter()
            .filter(|t| {
                t.parent_id.as_deref() == Some(id)
                    && ["queued", "running", "waiting"].contains(&t.status.as_str())
            })
            .map(|t| t.id.clone())
            .collect();
        for child in children {
            let _ = runtime::cancel(app, &child);
        }
    } else if resume {
        engine::spawn(app.clone(), id)?;
    }
    get(&state, id)
}
/// Restart recovery never replays a process whose side effects are unknown.
pub fn recover(db: &mut Database, dir: &std::path::Path) {
    for run in &mut db.workflow_runs {
        if run.status != "running" {
            continue;
        }
        run.status = "waiting".into();
        run.pause_requested = false;
        run.error = "应用已重启，请检查当前步骤后继续。已完成步骤不会重复执行。".into();
        if let Some(step) = run.steps.get_mut(run.cursor) {
            if step.status == "running" {
                if let Some(child) = step
                    .task_ids
                    .last()
                    .and_then(|id| db.tasks.iter().find(|t| &t.id == id))
                {
                    if child.status == "completed" {
                        step.output = engine::output(dir, &child.id);
                        step.status = "completed".into();
                        step.finished_at = Some(child.updated_at.clone());
                        run.cursor += 1;
                    } else {
                        step.status = "failed".into();
                    }
                } else {
                    step.status = "failed".into();
                }
            }
        }
        run.revision += 1;
        if let Some(task) = db.tasks.iter_mut().find(|t| t.id == run.id) {
            task.status = "waiting".into();
            task.preview = run.error.clone();
        }
    }
}
