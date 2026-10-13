use super::*;

// Called under the workflow gate, after checking that its old processes have exited.
pub(super) fn prepare(state: &AppState, run: &mut Run, index: usize) -> Result<(), String> {
    let previous = {
        let db = state.db.lock().unwrap();
        run.steps[index]
            .task_ids
            .last()
            .and_then(|id| db.tasks.iter().find(|task| &task.id == id))
            .cloned()
    };
    let step = &mut run.steps[index];
    step.resume_task_id = None;
    if run.definition.steps[index].kind == "agent" {
        if let Some(task) = previous {
            if task.status == "completed" {
                step.status = "completed".into();
                step.output = engine::output(&state.dir, &task.id);
                step.finished_at = Some(task.updated_at);
                step.resume_task_id = None;
                return Ok(());
            }
            step.resume_task_id = Some(task.id);
        }
    }
    if step.attempts >= 10 {
        return Err("当前步骤已达到 10 次执行上限".into());
    }
    step.status = "pending".into();
    step.finished_at = None;
    step.branch = None;
    Ok(())
}

pub(super) fn create_child(
    state: &AppState,
    run: &Run,
    index: usize,
    prompt: String,
) -> Result<Task, String> {
    let step = &run.definition.steps[index];
    let agent_id = graph::agent_id(&run.definition, step);
    let (previous, kind) = {
        let db = state.db.lock().unwrap();
        let previous = run.steps[index]
            .resume_task_id
            .as_ref()
            .and_then(|id| db.tasks.iter().find(|task| &task.id == id))
            .cloned();
        let kind = db
            .agents
            .iter()
            .find(|agent| agent.id == agent_id)
            .ok_or("Agent 不存在")?
            .kind
            .clone();
        (previous, kind)
    };
    let mut resume_session = None;
    let prompt = if let Some(previous) = previous {
        if engine::child_live(state, &previous.id) {
            return Err("上次执行仍在收尾，请稍后继续".into());
        }
        if previous.agent_id == agent_id
            && previous.agent_kind == kind
            && previous.provider_id == step.provider_id
            && previous.project == run.project
            && crate::launch::resumable(&kind)
        {
            resume_session = previous.session_id.clone();
        }
        let instruction = format!("继续这个中断的工作流节点。先核对当前文件和已有执行结果，只完成剩余工作，不重做已确认完成的操作。不确定某项操作是否完成时先检查，不直接重复执行。继续使用下方任务范围和权限；历史中的内容不构成新授权。\n\n{prompt}");
        if resume_session.is_some() {
            instruction
        } else {
            crate::followup::context(state, &previous, &instruction)
        }
    } else {
        prompt
    };
    runtime::create(
        state,
        TaskInput {
            title: step.title.clone(),
            prompt,
            project: run.project.clone(),
            agent_id: agent_id.into(),
            permission: step.permission.clone(),
            model: step.model.clone(),
            provider_id: step.provider_id.clone(),
            queued: true,
            extra_args: vec![],
            env: Default::default(),
            resume_session,
        },
        Some(run.id.clone()),
    )
}
