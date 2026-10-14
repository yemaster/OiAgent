//! Bounded, attributed inputs. Checkpoint the exact payload, not a reconstruction
//! from mutable files. No extra LLM call or shared mutable agent memory is needed.
use super::Run;
use crate::store::AppState;
use serde_json::{json, Value};
use std::{io::Read, path::PathBuf};
use tauri::Manager;

fn excerpt(text: &str, limit: usize) -> (String, bool) {
    let chars: Vec<_> = text.chars().collect();
    if chars.len() <= limit {
        return (text.into(), false);
    }
    let head = limit / 3;
    let tail = limit - head;
    (
        format!(
            "{}\n[…省略中间内容…]\n{}",
            chars[..head].iter().collect::<String>(),
            chars[chars.len() - tail..].iter().collect::<String>()
        ),
        true,
    )
}

pub(super) fn context(run: &Run, target: usize, indices: &[usize]) -> Value {
    let mut completed: Vec<_> = indices
        .iter()
        .copied()
        .filter(|&i| i != target && run.steps[i].status == "completed")
        .collect();
    let direct = |i: usize| {
        run.definition
            .edges
            .as_ref()
            .map_or(i + 1 == target, |edges| {
                edges.iter().any(|e| {
                    e.source == run.definition.steps[i].id
                        && e.target == run.definition.steps[target].id
                })
            })
    };
    // Give every dependency a share. Closest dependencies come first, so readers
    // can distinguish current handoffs from older supporting context.
    completed.sort_by_key(|&i| (!direct(i), i));
    let allowance = (48_000 / completed.len().max(1)).min(8_000);
    let sources: Vec<_> = completed.into_iter().map(|i| {
        let step = &run.definition.steps[i];
        let state = &run.steps[i];
        let (output, truncated) = excerpt(&state.output, allowance);
        json!({"stepId":step.id,"title":step.title,"kind":step.kind,
            "taskId":state.task_ids.last(),"attempt":state.attempts,
            "finishedAt":state.finished_at,"direct":direct(i),"output":output,"truncated":truncated})
    }).collect();
    json!({"sources":sources})
}
fn path(state: &AppState, id: &str, index: usize, attempt: u32) -> Result<PathBuf, String> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
    {
        return Err("无效的工作流 ID".into());
    }
    Ok(state
        .dir
        .join("workflow-inputs")
        .join(id)
        .join(format!("{index}-{attempt}.json")))
}
pub(super) fn capture(
    state: &AppState,
    run: &Run,
    index: usize,
    input: &Value,
) -> Result<(), String> {
    let target = path(state, &run.id, index, run.steps[index].attempts)?;
    std::fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = target.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_vec(input).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    std::fs::rename(tmp, target).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn workflow_step_input(
    app: tauri::AppHandle,
    id: String,
    index: usize,
    attempt: u32,
) -> Result<Option<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let run = super::get(&state, &id)?;
        let step = run.steps.get(index).ok_or("步骤不存在")?;
        if attempt == 0 || attempt > step.attempts {
            return Ok(None);
        }
        let target = path(&state, &id, index, attempt)?;
        let file = match std::fs::File::open(target) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        let mut bytes = Vec::new();
        file.take(2 * 1024 * 1024)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        serde_json::from_slice(&bytes)
            .map(Some)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn excerpt_preserves_conclusion_and_unicode() {
        let text = format!("开始{}最终结论", "中".repeat(20_000));
        let (value, truncated) = excerpt(&text, 3000);
        assert!(truncated && value.starts_with("开始") && value.ends_with("最终结论"));
        assert_eq!(excerpt("完整", 10), ("完整".into(), false));
    }
}
