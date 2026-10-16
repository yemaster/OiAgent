//! Optional background titles. Coalesce turns and never overwrite a manual name.
use crate::{
    models::{now, Task},
    store::AppState,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{Manager, State};
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TitleMode {
    Off,
    #[default]
    First,
    Every,
}
pub struct Job {
    generation: u64,
    owner: String,
    prompt: String,
}
#[tauri::command]
pub fn task_title_mode(state: State<AppState>) -> TitleMode {
    state.db.lock().unwrap().title_mode.clone()
}
#[tauri::command]
pub fn set_task_title_mode(state: State<AppState>, mode: TitleMode) -> Result<(), String> {
    let mut db = state.db.lock().unwrap();
    let mut next = db.clone();
    next.title_mode = mode;
    state.save(&next)?;
    *db = next;
    state.title_jobs.lock().unwrap().clear();
    Ok(())
}
fn valid_title(text: &str) -> Option<String> {
    let title = text.trim().trim_matches(['"', '\'', '“', '”']).trim();
    if title.is_empty()
        || title.chars().count() > 48
        || title.chars().any(char::is_control)
        || title.contains(['<', '>', '`'])
        || title.starts_with(['{', '[', '#'])
    {
        return None;
    }
    Some(title.to_owned())
}
fn allowed(db: &crate::models::Database, task: &Task) -> bool {
    db.title_mode != TitleMode::Off
        && !db.titles.contains_key(&task.id)
        && !task.archived
        && task.parent_id.is_none()
        && task.source != "workflow"
        && !["terminal", "supervisor"].contains(&task.agent_kind.as_str())
}
pub fn schedule<R: tauri::Runtime>(app: &tauri::AppHandle<R>, task: &Task) {
    let state = app.state::<AppState>();
    if crate::commands::slash(task.active_prompt.as_deref().unwrap_or(&task.prompt)).is_some() {
        return;
    }
    let id = task.id.clone();
    let owner = uuid::Uuid::new_v4().to_string();
    // Register in caller order, before spawning: thread scheduling cannot reorder turns.
    {
        let mut db = state.db.lock().unwrap();
        if !allowed(&db, task)
            || (db.title_mode == TitleMode::First
                && (task.active_prompt.is_some() || db.title_attempts.contains(&id)))
        {
            return;
        }
        let prompt=json!({"originalGoal":crate::history::short(crate::message_text::visible_user_text(&task.prompt),2000),"latestInstruction":crate::history::short(crate::message_text::visible_user_text(task.active_prompt.as_deref().unwrap_or(&task.prompt)),2000),"currentTitle":task.title}).to_string();
        let mut next = db.clone();
        next.title_attempts.insert(id.clone());
        if state.save(&next).is_err() {
            return;
        }
        *db = next;
        let mut jobs = state.title_jobs.lock().unwrap();
        if let Some(job) = jobs.get_mut(&id) {
            job.generation += 1;
            job.prompt = prompt;
            return;
        }
        jobs.insert(
            id.clone(),
            Job {
                generation: 0,
                owner: owner.clone(),
                prompt,
            },
        );
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let config = match crate::llm_settings::config(&state) {
            Ok(config) => config,
            Err(_) => {
                let mut jobs = state.title_jobs.lock().unwrap();
                if jobs.get(&id).is_some_and(|job| job.owner == owner) {
                    jobs.remove(&id);
                }
                return;
            }
        };
        loop {
            let (generation, prompt) = {
                let jobs = state.title_jobs.lock().unwrap();
                let Some(job) = jobs.get(&id).filter(|job| job.owner == owner) else {
                    return;
                };
                (job.generation, job.prompt.clone())
            };
            let result =
                crate::supervisor::request_short(&config, crate::llm_prompts::TASK_TITLE, &prompt)
                    .ok()
                    .and_then(|(text, _)| valid_title(&text));
            // Lock DB before job map, matching settings changes; stale results cannot win.
            let mut db = state.db.lock().unwrap();
            let mut jobs = state.title_jobs.lock().unwrap();
            let Some(job) = jobs.get(&id).filter(|job| job.owner == owner) else {
                return;
            };
            if job.generation != generation {
                drop(jobs);
                drop(db);
                continue;
            }
            jobs.remove(&id);
            if state
                .shutting_down
                .load(std::sync::atomic::Ordering::Acquire)
            {
                return;
            }
            let Some(current) = db.tasks.iter().find(|t| t.id == id) else {
                return;
            };
            if !allowed(&db, current) {
                return;
            }
            if let Some(title) = result {
                let mut next = db.clone();
                let current = next.tasks.iter_mut().find(|t| t.id == id).unwrap();
                current.title = title;
                current.updated_at = now();
                let task = current.clone();
                if state.save(&next).is_ok() {
                    *db = next;
                    drop(db);
                    drop(jobs);
                    crate::runtime::emit(&app, &task);
                }
            }
            return;
        }
    });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_short_names_rejects_model_commentary() {
        assert_eq!(valid_title("“修复登录跳转”"), Some("修复登录跳转".into()));
        for text in [
            "",
            "Title\nExplanation",
            "```title```",
            "{\"title\":\"x\"}",
            "<title>x</title>",
        ] {
            assert!(valid_title(text).is_none());
        }
        assert!(valid_title(&"长".repeat(49)).is_none());
    }
}

#[cfg(all(test, unix))]
mod integration {
    use super::*;
    use crate::{models::*, supervisor::LlmConfig};
    use std::{
        io::{BufRead, BufReader, Read, Write},
        sync::mpsc,
        time::Duration,
    };
    use tauri::test::{mock_builder, mock_context, noop_assets};
    fn fixture() -> (
        tauri::App<tauri::test::MockRuntime>,
        tempfile::TempDir,
        Task,
    ) {
        let dir = tempfile::tempdir().unwrap();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        app.manage(AppState::load(dir.path().into()).unwrap());
        let task:Task=serde_json::from_value(json!({"id":"title-task","title":"old","prompt":"实现上传接口","project":"/tmp","agentId":"codex","agentKind":"codex","status":"running","createdAt":"t","updatedAt":"t","preview":"","usage":{"input":0,"output":0,"cached":0,"known":false},"source":"managed","model":"","permission":"workspace-write","sessionId":null,"exitCode":null})).unwrap();
        app.state::<AppState>()
            .db
            .lock()
            .unwrap()
            .tasks
            .push(task.clone());
        (app, dir, task)
    }
    fn response(stream: &mut std::net::TcpStream, title: &str) {
        let body = json!({"choices":[{"message":{"content":title}}]}).to_string();
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
    }
    fn request(stream: &std::net::TcpStream) -> serde_json::Value {
        stream
            .set_read_timeout(Some(Duration::from_secs(4)))
            .unwrap();
        let mut r = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        let mut length = 0;
        loop {
            line.clear();
            r.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                length = value.trim().parse::<usize>().unwrap();
            }
        }
        let mut body = vec![0; length];
        r.read_exact(&mut body).unwrap();
        serde_json::from_slice(&body).unwrap()
    }
    #[test]
    fn newer_turn_supersedes_inflight_title_and_manual_rename_wins() {
        let (app, _dir, mut task) = fixture();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let state = app.state::<AppState>();
        state.db.lock().unwrap().title_mode = TitleMode::Every;
        *state.llm.lock().unwrap() = crate::llm_settings::LlmSettings::session(LlmConfig {
            base_url: format!("http://{}/v1", listener.local_addr().unwrap()),
            model: "test".into(),
            api_key: "test".into(),
        });
        let (seen, seen_rx) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        let server = std::thread::spawn(move || {
            for title in ["过时标题", "上传接口重试"] {
                let (mut stream, _) = listener.accept().unwrap();
                let body = request(&stream);
                assert!(body.get("tools").is_none());
                seen.send(body).unwrap();
                release_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                response(&mut stream, title);
            }
        });
        schedule(app.handle(), &task);
        seen_rx.recv_timeout(Duration::from_secs(4)).unwrap();
        task.active_prompt = Some("增加上传失败重试".into());
        schedule(app.handle(), &task);
        release.send(()).unwrap();
        let second = seen_rx.recv_timeout(Duration::from_secs(4)).unwrap();
        assert!(second["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("增加上传失败重试"));
        assert_eq!(state.db.lock().unwrap().tasks[0].title, "old");
        {
            let mut db = state.db.lock().unwrap();
            db.titles.insert(task.id.clone(), "我的标题".into());
            db.tasks[0].title = "我的标题".into();
        }
        release.send(()).unwrap();
        server.join().unwrap();
        for _ in 0..200 {
            if state.title_jobs.lock().unwrap().is_empty() {
                break;
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(state.db.lock().unwrap().tasks[0].title, "我的标题");
        assert!(state.title_jobs.lock().unwrap().is_empty());
    }
    #[test]
    fn off_and_first_mode_never_schedule_followup_titles() {
        let (app, _dir, mut task) = fixture();
        let state = app.state::<AppState>();
        state.db.lock().unwrap().title_mode = TitleMode::Off;
        schedule(app.handle(), &task);
        assert!(state.title_jobs.lock().unwrap().is_empty());
        state.db.lock().unwrap().title_mode = TitleMode::First;
        task.active_prompt = Some("followup".into());
        schedule(app.handle(), &task);
        assert!(state.title_jobs.lock().unwrap().is_empty());
        assert!(state.db.lock().unwrap().title_attempts.is_empty());
    }
}
