//! Discover SDK command metadata from the installed CLI, never from a bundled list.
use crate::{models::*, store::AppState};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub commands: Vec<Command>,
    pub models: Vec<Model>,
    #[serde(default)]
    fingerprint: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Command {
    pub name: String,
    pub description: String,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Model {
    pub value: String,
    pub label: String,
}

pub fn slash(text: &str) -> Option<&str> {
    let name = text
        .trim_start()
        .strip_prefix('/')?
        .split_whitespace()
        .next()?;
    (!name.is_empty()
        && name.len() <= 160
        && name
            .chars()
            .all(|c| c.is_alphanumeric() || "-_:.".contains(c)))
    .then_some(name)
}
fn fingerprint(agent: &Agent) -> String {
    format!("{}\n{}\n{}", agent.id, agent.executable, agent.version)
}
fn parse(value: &Value) -> Catalog {
    let commands = value
        .get("commands")
        .or_else(|| value.get("slash_commands"));
    let commands = commands
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(512)
        .filter_map(|v| {
            let name = v
                .as_str()
                .or_else(|| v["name"].as_str())?
                .trim_start_matches('/');
            if slash(&format!("/{name}")) != Some(name) {
                return None;
            }
            Some(Command {
                name: name.into(),
                description: v["description"]
                    .as_str()
                    .unwrap_or("")
                    .chars()
                    .take(240)
                    .collect(),
            })
        })
        .collect();
    let models = value["models"]
        .as_array()
        .into_iter()
        .flatten()
        .take(256)
        .filter_map(|v| {
            if v["isEnabled"] == false {
                return None;
            }
            let id = v["value"].as_str().or_else(|| v["id"].as_str())?;
            Some(Model {
                value: id.into(),
                label: v["displayName"].as_str().unwrap_or(id).into(),
            })
        })
        .collect();
    Catalog {
        commands,
        models,
        fingerprint: String::new(),
    }
}
pub fn observe(state: &AppState, id: &str, value: &Value) {
    if value.get("commands").is_none() && value.get("slash_commands").is_none() {
        return;
    }
    let db = state.db.lock().unwrap();
    let Some(task) = db.tasks.iter().find(|t| t.id == id) else {
        return;
    };
    let Some(agent) = db.agents.iter().find(|a| a.id == task.agent_id) else {
        return;
    };
    let mut catalog = parse(value);
    catalog.fingerprint = fingerprint(agent);
    drop(db);
    let path = state.dir.join("logs").join(format!("{id}.commands.json"));
    if value.get("models").is_none() {
        if let Some(previous) = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Catalog>(&b).ok())
        {
            if previous.fingerprint == catalog.fingerprint {
                catalog.models = previous.models;
            }
        }
    }
    if let Ok(bytes) = serde_json::to_vec(&catalog) {
        let _ = std::fs::write(path, bytes);
    }
}
pub fn validate_initial(value: &Value, text: &str) -> Result<(), String> {
    let Some(name) = slash(text) else {
        return Ok(());
    };
    if !parse(value).commands.iter().any(|c| c.name == name) {
        return Err(format!(
            "当前 CLI 未提供 /{name} 的图形接口，请使用原生终端"
        ));
    }
    Ok(())
}
#[tauri::command]
pub fn task_commands(
    state: tauri::State<AppState>,
    id: String,
    agent_id: String,
) -> Result<Catalog, String> {
    let db = state.db.lock().unwrap();
    // Validate IDs before constructing a log path; imported history has no catalog yet.
    let Some(task) = db
        .tasks
        .iter()
        .find(|t| t.id == id && t.agent_id == agent_id)
    else {
        return Ok(Catalog::default());
    };
    let Some(agent) = db.agents.iter().find(|a| a.id == task.agent_id) else {
        return Ok(Catalog::default());
    };
    let expected = fingerprint(agent);
    drop(db);
    let path = state.dir.join("logs").join(format!("{id}.commands.json"));
    if std::fs::metadata(&path)
        .map(|m| m.len() > 512 * 1024)
        .unwrap_or(true)
    {
        return Ok(Catalog::default());
    }
    let catalog: Catalog = std::fs::read(path)
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    Ok(if catalog.fingerprint == expected {
        catalog
    } else {
        Catalog::default()
    })
}
#[tauri::command]
pub async fn set_task_model(
    app: tauri::AppHandle,
    id: String,
    model: String,
) -> Result<Task, String> {
    if model.len() > 240 || model.chars().any(char::is_control) {
        return Err("模型名称无效".into());
    }
    tauri::async_runtime::spawn_blocking(move || crate::approvals::change_model(&app, &id, &model))
        .await
        .map_err(|e| e.to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn runtime_metadata_controls_commands_without_treating_paths_as_commands() {
        assert_eq!(slash("/model sonnet"), Some("model"));
        assert_eq!(slash("/plugin:review changes"), Some("plugin:review"));
        assert_eq!(slash("/Users/me/project/file.rs"), None);
        let init = serde_json::json!({"commands":[{"name":"my-new-command","description":"New CLI command"}]});
        assert!(validate_initial(&init, "/my-new-command argument").is_ok());
        assert!(validate_initial(&init, "/unknown").is_err());
        assert!(validate_initial(&serde_json::json!({}), "/compact").is_err());
    }
}
