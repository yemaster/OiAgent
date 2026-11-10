//! A visible conversation receives SDK records directly, in persisted order.
//! The initial tail and subscription share the append lock: no read/subscribe gap.
use crate::{models::Message, store::AppState};
use serde::Serialize;
use tauri::{ipc::Channel, Manager};

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum OutputEvent {
    Snapshot {
        messages: Vec<Message>,
        truncated: bool,
    },
    Record {
        message: Message,
    },
}
struct Subscription {
    id: String,
    task: String,
    channel: Channel<OutputEvent>,
}
#[derive(Default)]
pub(crate) struct Hub {
    subscriptions: Vec<Subscription>,
}
impl Hub {
    pub fn remove(&mut self, id: &str) {
        self.subscriptions.retain(|s| s.id != id);
    }
    pub fn publish(&mut self, task: &str, message: &Message) {
        // No subscriber means no IPC/serialization or duplicate text buffering.
        self.subscriptions.retain(|s| {
            s.task != task
                || s.channel
                    .send(OutputEvent::Record {
                        message: message.clone(),
                    })
                    .is_ok()
        });
    }
}

fn subscribe(
    state: &AppState,
    id: &str,
    subscription: String,
    channel: Channel<OutputEvent>,
) -> Result<(), String> {
    if subscription.is_empty() || subscription.len() > 128 {
        return Err("输出订阅标识无效".into());
    }
    {
        let db = state.db.lock().map_err(|e| e.to_string())?;
        if db.deleted_tasks.contains(id)
            || !db
                .tasks
                .iter()
                .any(|task| task.id == id && task.source == "managed")
        {
            return Err("任务不可订阅".into());
        }
    }
    let mut hub = state.output_stream.lock().map_err(|e| e.to_string())?;
    hub.remove(&subscription);
    if hub.subscriptions.len() >= 16 {
        return Err("打开的输出订阅过多".into());
    }
    let path = state.dir.join("logs").join(format!("{id}.messages.jsonl"));
    let (messages, truncated) = state.detail_logs.lock().unwrap().read(&path);
    channel
        .send(OutputEvent::Snapshot {
            messages,
            truncated,
        })
        .map_err(|e| e.to_string())?;
    hub.subscriptions.push(Subscription {
        id: subscription,
        task: id.into(),
        channel,
    });
    Ok(())
}

#[tauri::command]
pub async fn subscribe_task_output(
    app: tauri::AppHandle,
    id: String,
    subscription: String,
    on_output: Channel<OutputEvent>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        subscribe(&app.state::<AppState>(), &id, subscription, on_output)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn unsubscribe_task_output(state: tauri::State<'_, AppState>, subscription: String) {
    state.output_stream.lock().unwrap().remove(&subscription);
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    use std::sync::{Arc, Mutex};
    use tauri::ipc::InvokeResponseBody;

    fn fixture() -> (tempfile::TempDir, Arc<AppState>) {
        let dir = tempfile::tempdir().unwrap();
        let state = Arc::new(AppState::load(dir.path().into()).unwrap());
        for id in ["a", "b"] {
            state.db.lock().unwrap().tasks.push(
                serde_json::from_value(json!({
                    "id":id,"title":"t","prompt":"p","project":"/tmp","agentId":"claude",
                    "agentKind":"claude","status":"running","createdAt":"","updatedAt":"",
                    "preview":"","usage":{"input":0,"output":0,"cached":0,"known":false},
                    "source":"managed","model":"","permission":"default"
                }))
                .unwrap(),
            );
        }
        (dir, state)
    }
    fn row(text: &str) -> Message {
        serde_json::from_value(
            json!({"role":"assistant","text":text,"timestamp":"t","streamId":"block","delta":true}),
        )
        .unwrap()
    }
    fn channel() -> (Channel<OutputEvent>, Arc<Mutex<Vec<Value>>>) {
        let events = Arc::new(Mutex::new(Vec::new()));
        let received = events.clone();
        (
            Channel::new(move |body| {
                if let InvokeResponseBody::Json(text) = body {
                    received
                        .lock()
                        .unwrap()
                        .push(serde_json::from_str(&text).unwrap());
                }
                Ok(())
            }),
            events,
        )
    }
    #[test]
    fn pushes_records_immediately_without_task_notifications_or_detail_reads() {
        let (_dir, state) = fixture();
        crate::runtime::append_record(&state, "a", &row("before"));
        let (channel, events) = channel();
        subscribe(&state, "a", "pane".into(), channel).unwrap();
        crate::runtime::append_record(&state, "a", &row(" after"));
        crate::runtime::append_record(&state, "b", &row("other task"));
        {
            let events = events.lock().unwrap();
            assert_eq!(events.len(), 2);
            assert_eq!(events[0]["type"], "snapshot");
            assert_eq!(events[0]["messages"][0]["text"], "before");
            assert_eq!(events[1]["type"], "record");
            assert_eq!(events[1]["message"]["text"], " after");
        }
        state.output_stream.lock().unwrap().remove("pane");
        crate::runtime::append_record(&state, "a", &row(" hidden"));
        assert_eq!(events.lock().unwrap().len(), 2);
    }
    #[test]
    fn subscription_racing_output_has_no_missing_or_replayed_chunks() {
        let (_dir, state) = fixture();
        let writer = state.clone();
        let work = std::thread::spawn(move || {
            for i in 0..300 {
                crate::runtime::append_record(&writer, "a", &row(&format!("{i},")));
            }
        });
        let (channel, events) = channel();
        subscribe(&state, "a", "pane".into(), channel).unwrap();
        work.join().unwrap();
        let events = events.lock().unwrap();
        let mut output = events[0]["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["text"].as_str().unwrap())
            .collect::<String>();
        for event in &events[1..] {
            output.push_str(event["message"]["text"].as_str().unwrap());
        }
        assert_eq!(
            output,
            (0..300).map(|i| format!("{i},")).collect::<String>()
        );
    }
}
