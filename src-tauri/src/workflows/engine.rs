use super::*;
use std::{
    io::{Read, Seek, SeekFrom},
    time::{Duration, Instant},
};

pub(super) fn save_run<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    mut run: Run,
) -> Result<(), String> {
    let state = app.state::<AppState>();
    run.updated_at = now();
    run.revision += 1;
    let task = transaction(&state, |db| {
        let current = db
            .workflow_runs
            .iter_mut()
            .find(|r| r.id == run.id)
            .ok_or("运行记录不存在")?;
        if current.revision + 1 != run.revision {
            return Err("运行状态已更新".into());
        }
        *current = run.clone();
        let task = db
            .tasks
            .iter_mut()
            .find(|t| t.id == run.id)
            .ok_or("父任务不存在")?;
        task.status = run.status.clone();
        task.updated_at = run.updated_at.clone();
        task.usage = run.llm_usage.clone();
        task.preview = if !run.error.is_empty() {
            run.error.clone()
        } else if run.status == "completed" {
            "工作流已完成".into()
        } else if run.pause_requested {
            "当前步骤结束后暂停".into()
        } else if run.definition.edges.is_some() {
            format!(
                "{} / {} 已完成 · {} 进行中",
                run.steps.iter().filter(|s| s.status == "completed").count(),
                run.steps.len(),
                run.steps.iter().filter(|s| s.status == "running").count()
            )
        } else {
            run.definition
                .steps
                .get(run.cursor)
                .map(|s| format!("{}/{} · {}", run.cursor + 1, run.steps.len(), s.title))
                .unwrap_or_default()
        };
        let task = task.clone();
        crate::temporary_projects::update_expiry(db, chrono::Utc::now());
        Ok(task)
    })?;
    runtime::emit(app, &task);
    Ok(())
}
pub(super) fn spawn<R: tauri::Runtime>(app: tauri::AppHandle<R>, id: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    if !state.workflow_workers.lock().unwrap().insert(id.into()) {
        return Err("工作流已在运行".into());
    }
    let id = id.to_string();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let result = if get(&state, &id).is_ok_and(|r| r.definition.edges.is_some()) {
            graph::run(&app, &id)
        } else {
            run(&app, &id)
        };
        let _gate = state.workflow_lock.lock().unwrap();
        if let Err(error) = result {
            if let Ok(mut current) = get(&state, &id) {
                if current.status == "running" {
                    current.status = "waiting".into();
                    current.error = error;
                    if current.definition.edges.is_some() {
                        for step in &mut current.steps {
                            if step.status == "running" {
                                if let Some(child) = step.task_ids.last() {
                                    let _ = runtime::cancel(&app, child);
                                }
                                step.status = "failed".into();
                                step.finished_at = Some(now());
                            }
                        }
                        graph::focus(&mut current);
                    } else if let Some(step) = current.steps.get_mut(current.cursor) {
                        step.status = "failed".into();
                        step.finished_at = Some(now());
                    }
                    if let Err(error) = save_run(&app, current) {
                        // No next step is dispatched after a persistence failure.
                        runtime::append_message(
                            &state,
                            &id,
                            "assistant",
                            &format!("保存工作流进度失败：{error}"),
                        );
                    }
                }
            }
        }
        state.workflow_workers.lock().unwrap().remove(&id);
    });
    Ok(())
}
pub(super) fn output(dir: &std::path::Path, id: &str) -> String {
    let path = dir.join("logs").join(format!("{id}.messages.jsonl"));
    let Ok(mut file) = std::fs::File::open(path) else {
        return String::new();
    };
    let length = file.metadata().map(|m| m.len()).unwrap_or(0);
    let _ = file.seek(SeekFrom::Start(length.saturating_sub(256000)));
    let mut bytes = Vec::new();
    let _ = file.take(256000).read_to_end(&mut bytes);
    let text = String::from_utf8_lossy(&bytes)
        .lines()
        .filter_map(|line| serde_json::from_str::<Message>(line).ok())
        .filter(|m| m.role == "assistant" && m.tool.is_none())
        .map(|m| m.text)
        .collect::<Vec<_>>()
        .join("\n");
    // Keep the final answer, not the first tool preamble. Full logs remain in each task.
    let chars: Vec<_> = text.chars().collect();
    chars[chars.len().saturating_sub(12000)..].iter().collect()
}
fn context(run: &Run) -> String {
    run.steps
        .iter()
        .zip(&run.definition.steps)
        .take(run.cursor)
        .filter(|(s, _)| s.status == "completed")
        .map(|(state, step)| {
            format!(
                "STEP: {}\nUNTRUSTED OUTPUT:\n{}",
                step.title,
                crate::history::short(&state.output, 3000)
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}
// Status alone is insufficient: an SDK result may close stdin before the process
// and its output readers finish. Keep the node attached until runtime settles it.
pub(super) fn child_live(state: &AppState, id: &str) -> bool {
    state.children.lock().unwrap().contains_key(id) || crate::approvals::live(state, id)
}

pub(super) fn request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    snapshot: &Run,
    index: usize,
    config: &supervisor::LlmConfig,
    system: &str,
    prompt: &str,
) -> Result<(String, Usage), String> {
    let run_id = &snapshot.id;
    let is_current = |run: &Run| {
        run.status == "running"
            && run.steps[index].status == "running"
            && run.steps[index].attempts == snapshot.steps[index].attempts
    };
    if !is_current(&get(&app.state::<AppState>(), run_id)?) {
        return Err("工作流已停止".into());
    }
    supervisor::request_with_retry(config, system, prompt, |retry, delay| {
        let state = app.state::<AppState>();
        {
            let _gate = state.workflow_lock.lock().unwrap();
            let mut current = get(&state, run_id)?;
            if !is_current(&current) {
                return Err("工作流已停止".into());
            }
            let message = format!("LLM 暂时不可用，{} 秒后重试（{retry}/2）", delay.as_secs());
            current.steps[index].output = message.clone();
            save_run(app, current)?;
            runtime::append_message(&state, run_id, "system", &message);
        }
        let started = Instant::now();
        while started.elapsed() < delay {
            if !is_current(&get(&state, run_id)?) {
                return Err("工作流已停止".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Ok(())
    })
}

pub(super) fn execution_limit_reached(limit: Option<u32>, elapsed: Duration) -> bool {
    limit.is_some_and(|minutes| elapsed >= Duration::from_secs(u64::from(minutes) * 60))
}
fn run<R: tauri::Runtime>(app: &tauri::AppHandle<R>, id: &str) -> Result<(), String> {
    let state = app.state::<AppState>();
    loop {
        let (current, step, child) = {
            let _gate = state.workflow_lock.lock().unwrap();
            let mut current = get(&state, id)?;
            if current.status != "running" {
                return Ok(());
            }
            if current.pause_requested {
                current.status = "waiting".into();
                current.pause_requested = false;
                current.error = "已暂停，可从下一步继续".into();
                save_run(app, current)?;
                return Ok(());
            }
            if current.cursor >= current.steps.len() {
                current.status = "completed".into();
                save_run(app, current)?;
                runtime::append_message(&state, id, "assistant", "工作流全部步骤已完成。");
                return Ok(());
            }
            let step = current.definition.steps[current.cursor].clone();
            if step.kind == "approval" {
                current.steps[current.cursor].status = "approval".into();
                current.status = "waiting".into();
                current.error = format!("等待确认：{}", step.title);
                save_run(app, current)?;
                return Ok(());
            }
            if current.steps[current.cursor].attempts >= 10 {
                return Err("步骤已达到 10 次执行上限".into());
            }
            current.steps[current.cursor].status = "running".into();
            current.steps[current.cursor].attempts += 1;
            current.steps[current.cursor].started_at = Some(now());
            current.steps[current.cursor].finished_at = None;
            // Checkpoint the attempt BEFORE creating or executing any external work.
            save_run(app, current.clone())?;
            current = get(&state, id)?;
            let child = if step.kind == "agent" {
                let prompt = crate::llm_prompts::agent_task(serde_json::json!({
                    "goal": current.definition.goal, "title": step.title, "task": step.prompt,
                    "previousAttempt": current.steps[current.cursor].output,
                    "permission": step.permission, "legacyFeedback": current.feedback,
                    "evidence": context(&current)
                }));
                let child = continuation::create_child(&state, &current, current.cursor, prompt)?;
                current.steps[current.cursor].resume_task_id = None;
                current.steps[current.cursor]
                    .task_ids
                    .push(child.id.clone());
                save_run(app, current.clone())?;
                // Cancellation takes the same gate: no process can launch after it returns.
                runtime::start(app.clone(), child.id.clone())?;
                Some(child.id)
            } else {
                None
            };
            runtime::append_message(
                &state,
                id,
                "assistant",
                &format!("开始步骤 {}：{}", current.cursor + 1, step.title),
            );
            (current, step, child)
        };
        let (result, usage, passed) = if let Some(child_id) = child {
            let started = Instant::now();
            let finished = loop {
                if get(&state, id)?.status != "running" {
                    let _ = runtime::cancel(app, &child_id);
                    return Ok(());
                }
                let child = state
                    .db
                    .lock()
                    .unwrap()
                    .tasks
                    .iter()
                    .find(|t| t.id == child_id)
                    .cloned()
                    .ok_or("子任务不存在")?;
                if !["running", "queued"].contains(&child.status.as_str())
                    && !child_live(&state, &child.id)
                {
                    break child;
                }
                if execution_limit_reached(step.execution_timeout_minutes, started.elapsed()) {
                    let _ = runtime::cancel(app, &child_id);
                    return Err(format!("已达到设置的 {} 分钟执行时限，当前步骤已停止。可调整时限后新建运行，或重试此步骤。", step.execution_timeout_minutes.unwrap()));
                }
                std::thread::sleep(Duration::from_millis(250));
            };
            let result = output(&state.dir, &child_id);
            if finished.status != "completed" {
                let _gate = state.workflow_lock.lock().unwrap();
                let mut latest = get(&state, id)?;
                if latest.status != "running" {
                    return Ok(());
                }
                latest.steps[latest.cursor].output = result;
                save_run(app, latest)?;
                return Err(format!(
                    "{}未完成（{}）：{}",
                    step.title, finished.status, finished.preview
                ));
            }
            (
                if result.is_empty() {
                    "Agent 已退出，未提供文字结果。请打开执行记录查看工具输出。".into()
                } else {
                    result
                },
                Usage::default(),
                true,
            )
        } else {
            let config = crate::llm_settings::config(&state)?;
            let review_input = serde_json::json!({
                "goal": current.definition.goal,
                "criteria": step.prompt,
                "legacyFeedback": current.feedback,
                "evidence": context(&current)
            });
            let (text, usage) = request(
                app,
                &current,
                current.cursor,
                &config,
                crate::llm_prompts::REVIEW,
                &review_input.to_string(),
            )?;
            // Account for the request even if the model's review cannot be parsed.
            {
                let _gate = state.workflow_lock.lock().unwrap();
                let mut latest = get(&state, id)?;
                latest.llm_usage.add(&usage);
                save_run(app, latest)?;
            }
            let review = crate::llm_prompts::review_decision(supervisor::parse_json(&text)?)?;
            (
                crate::history::short(&review.summary, 12000),
                Usage::default(),
                review.passed,
            )
        };
        let _gate = state.workflow_lock.lock().unwrap();
        let mut latest = get(&state, id)?;
        if latest.status != "running" {
            return Ok(());
        }
        let index = latest.cursor;
        latest.llm_usage.add(&usage);
        latest.steps[index].output = result.clone();
        latest.steps[index].finished_at = Some(now());
        runtime::append_message(
            &state,
            id,
            "assistant",
            &format!("### {}\n\n{}", step.title, result),
        );
        if !passed {
            latest.feedback = result;
            if latest.steps[index].repairs < step.max_repairs
                && index > 0
                && latest.steps[index - 1].attempts < 10
            {
                latest.steps[index].repairs += 1;
                latest.steps[index].status = "pending".into();
                latest.steps[index - 1].status = "pending".into();
                latest.cursor -= 1;
            } else {
                latest.steps[index].status = "failed".into();
                latest.status = "waiting".into();
                latest.error = "检查未通过，请查看结果，可补充说明后返工或重新检查。".into();
            }
        } else {
            latest.steps[index].status = "completed".into();
            latest.cursor += 1;
            latest.feedback.clear();
        }
        save_run(app, latest)?;
    }
}
