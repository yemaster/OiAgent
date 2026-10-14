use super::*;
use std::collections::HashSet;

pub(super) fn affected(run: &Run, source: usize) -> HashSet<usize> {
    if run.definition.edges.is_none() {
        return (source..run.steps.len()).collect();
    }
    let mut affected = HashSet::from([source]);
    loop {
        let before = affected.len();
        for edge in run.definition.edges.as_deref().unwrap_or_default() {
            let from = run
                .definition
                .steps
                .iter()
                .position(|step| step.id == edge.source)
                .unwrap();
            let to = run
                .definition
                .steps
                .iter()
                .position(|step| step.id == edge.target)
                .unwrap();
            if affected.contains(&from) {
                affected.insert(to);
            }
        }
        if affected.len() == before {
            return affected;
        }
    }
}

pub(super) fn control<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    id: &str,
    revision: u64,
    review_id: &str,
    source_id: &str,
    feedback: &str,
) -> Result<Run, String> {
    let state = app.state::<AppState>();
    let _gate = state.workflow_lock.lock().unwrap();
    let mut run = get(&state, id)?;
    if run.revision != revision {
        return Err("运行状态已更新，请稍后重试".into());
    }
    if run.status != "waiting" || state.workflow_workers.lock().unwrap().contains(id) {
        return Err("请先暂停派发，等待正在执行的节点结束".into());
    }
    if feedback.len() > 8000 {
        return Err("补充说明最多 8 KB".into());
    }
    let review = run
        .definition
        .steps
        .iter()
        .position(|step| step.id == review_id)
        .ok_or("验收节点不存在")?;
    let source = run
        .definition
        .steps
        .iter()
        .position(|step| step.id == source_id)
        .ok_or("返工节点不存在")?;
    if run.definition.steps[review].kind != "review"
        || run.steps[review].status != "failed"
        || run.definition.steps[source].kind != "agent"
    {
        return Err("请选择未通过的验收和前序 Agent 节点".into());
    }
    let affected = affected(&run, source);
    if !affected.contains(&review) {
        return Err("返工节点必须是此验收的前序 Agent".into());
    }
    if run.steps[source].task_ids.is_empty() {
        return Err("此 Agent 尚未执行".into());
    }
    if affected.iter().any(|&i| run.steps[i].attempts >= 10) {
        return Err("相关节点已达到 10 次执行上限".into());
    }
    crate::temporary_projects::check_available(&state.db.lock().unwrap(), &run.project)?;
    let children: Vec<_> = state
        .db
        .lock()
        .unwrap()
        .tasks
        .iter()
        .filter(|t| t.parent_id.as_deref() == Some(id))
        .cloned()
        .collect();
    if children
        .iter()
        .any(|t| t.status == "running" || engine::child_live(&state, &t.id))
    {
        return Err("子任务仍在执行，请等待结束后返工".into());
    }
    for child in children
        .iter()
        .filter(|t| ["queued", "waiting"].contains(&t.status.as_str()))
    {
        runtime::cancel(app, &child.id)?;
    }
    let report = format!(
        "验收要求：{}\n验收结果：{}",
        run.definition.steps[review].prompt, run.steps[review].output
    );
    for i in affected {
        let step = &mut run.steps[i];
        step.status = "pending".into();
        step.branch = None;
        step.finished_at = None;
        step.started_at = None;
        step.resume_task_id = None;
        step.repair_feedback.clear();
        if i != source {
            step.output.clear();
        }
    }
    run.steps[source].resume_task_id = run.steps[source].task_ids.last().cloned();
    run.steps[source].repair_feedback = report;
    run.steps[review].repairs += 1;
    run.feedback = feedback.into();
    run.status = "running".into();
    run.pause_requested = false;
    run.error.clear();
    run.cursor = source;
    if run.definition.edges.is_some() {
        graph::focus(&mut run);
    }
    engine::save_run(app, run)?;
    engine::spawn(app.clone(), id)?;
    get(&state, id)
}

#[tauri::command]
pub fn rework_workflow(
    app: tauri::AppHandle,
    id: String,
    revision: u64,
    review_id: String,
    source_id: String,
    feedback: String,
) -> Result<Run, String> {
    control(&app, &id, revision, &review_id, &source_id, &feedback)
}
