use crate::{integrations::atomic_write, store::AppState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};
use tauri::State;

const LIMIT: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub project: String,
    pub important: bool,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
}

#[derive(Deserialize)]
pub struct TodoInput {
    pub id: String,
    pub title: String,
    pub notes: String,
    pub project: String,
    pub important: bool,
}

#[derive(Serialize)]
pub struct TodoList {
    pub items: Vec<Todo>,
    pub revision: String,
}

fn read(path: &Path) -> Result<TodoList, String> {
    let mut bytes = vec![];
    match std::fs::File::open(path) {
        Ok(file) => {
            file.take(LIMIT as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => bytes.extend(b"[]"),
        Err(e) => return Err(e.to_string()),
    }
    if bytes.len() > LIMIT {
        return Err("计划文件超过 8 MB".into());
    }
    Ok(TodoList {
        items: serde_json::from_slice(&bytes).map_err(|_| "计划文件格式异常，原文件未修改")?,
        revision: format!("{:x}", Sha256::digest(&bytes)),
    })
}

enum Change {
    Save(TodoInput),
    Complete { id: String, completed: bool },
    Remove(String),
}

fn change(path: &Path, expected: &str, action: Change) -> Result<TodoList, String> {
    let mut list = read(path)?;
    if list.revision != expected {
        return Err("计划已在其他页面修改，请刷新列表后重试。未保存的内容会保留。".into());
    }
    let now = chrono::Utc::now().to_rfc3339();
    match action {
        Change::Save(input) => {
            let title = input.title.trim().to_string();
            let project = input.project.trim().to_string();
            if title.is_empty() || title.chars().count() > 200 {
                return Err("请填写计划名称，最多 200 字".into());
            }
            if input.notes.len() > 32 * 1024 || project.len() > 4096 || project.contains('\0') {
                return Err("备注最多 32 KB，项目路径最多 4096 字节且不能包含空字符".into());
            }
            if input.id.is_empty() {
                list.items.push(Todo {
                    id: uuid::Uuid::new_v4().to_string(),
                    title,
                    notes: input.notes,
                    project,
                    important: input.important,
                    created_at: now.clone(),
                    updated_at: now,
                    completed_at: None,
                });
            } else {
                let item = list
                    .items
                    .iter_mut()
                    .find(|t| t.id == input.id)
                    .ok_or("计划不存在，请刷新列表")?;
                item.title = title;
                item.notes = input.notes;
                item.project = project;
                item.important = input.important;
                item.updated_at = now;
            }
        }
        Change::Complete { id, completed } => {
            let item = list
                .items
                .iter_mut()
                .find(|t| t.id == id)
                .ok_or("计划不存在，请刷新列表")?;
            if completed != item.completed_at.is_some() {
                item.completed_at = completed.then(|| now.clone());
                item.updated_at = now;
            }
        }
        Change::Remove(id) => {
            if !list.items.iter().any(|t| t.id == id) {
                return Err("计划不存在，请刷新列表".into());
            }
            list.items.retain(|t| t.id != id);
        }
    }
    if list.items.len() > 5000 {
        return Err("最多保存 5000 条计划，请删除不再需要的已完成计划".into());
    }
    let bytes = serde_json::to_vec_pretty(&list.items).map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("计划总大小超过 8 MB".into());
    }
    atomic_write(path, &bytes)?;
    read(path)
}

#[tauri::command]
pub fn list_todos(state: State<AppState>) -> Result<TodoList, String> {
    let _lock = state.config_lock.lock().unwrap();
    read(&state.dir.join("todos.json"))
}

#[tauri::command]
pub fn save_todo(
    state: State<AppState>,
    item: TodoInput,
    expected: String,
) -> Result<TodoList, String> {
    let _lock = state.config_lock.lock().unwrap();
    change(&state.dir.join("todos.json"), &expected, Change::Save(item))
}

#[tauri::command]
pub fn complete_todo(
    state: State<AppState>,
    id: String,
    completed: bool,
    expected: String,
) -> Result<TodoList, String> {
    let _lock = state.config_lock.lock().unwrap();
    change(
        &state.dir.join("todos.json"),
        &expected,
        Change::Complete { id, completed },
    )
}

#[tauri::command]
pub fn remove_todo(
    state: State<AppState>,
    id: String,
    expected: String,
) -> Result<TodoList, String> {
    let _lock = state.config_lock.lock().unwrap();
    change(&state.dir.join("todos.json"), &expected, Change::Remove(id))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input(id: &str, title: &str) -> TodoInput {
        TodoInput {
            id: id.into(),
            title: title.into(),
            notes: "验收要求".into(),
            project: "/work/app".into(),
            important: true,
        }
    }
    #[test]
    fn lifecycle_persists_and_rejects_stale_writes() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("todos.json");
        let empty = read(&path).unwrap();
        let added = change(&path, &empty.revision, Change::Save(input("", "计划"))).unwrap();
        let id = added.items[0].id.clone();
        assert_eq!(read(&path).unwrap().items[0].project, "/work/app");
        assert!(change(&path, &empty.revision, Change::Remove(id.clone())).is_err());
        let done = change(
            &path,
            &added.revision,
            Change::Complete {
                id: id.clone(),
                completed: true,
            },
        )
        .unwrap();
        let edited = change(&path, &done.revision, Change::Save(input(&id, "修改名称"))).unwrap();
        assert_eq!(edited.items[0].completed_at, done.items[0].completed_at);
        assert_eq!(edited.items[0].created_at, added.items[0].created_at);
        let restored = change(
            &path,
            &edited.revision,
            Change::Complete {
                id: id.clone(),
                completed: false,
            },
        )
        .unwrap();
        assert!(restored.items[0].completed_at.is_none());
        let removed = change(&path, &restored.revision, Change::Remove(id)).unwrap();
        assert!(removed.items.is_empty());
    }
    #[test]
    fn invalid_inputs_and_corruption_never_overwrite_data() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("todos.json");
        let empty = read(&path).unwrap();
        assert!(change(&path, &empty.revision, Change::Save(input("", "  "))).is_err());
        assert!(change(
            &path,
            &empty.revision,
            Change::Save(input("missing", "计划"))
        )
        .is_err());
        let mut oversized = input("", "计划");
        oversized.notes = "a".repeat(32769);
        assert!(change(&path, &empty.revision, Change::Save(oversized)).is_err());
        std::fs::write(&path, b"broken").unwrap();
        assert!(change(&path, &empty.revision, Change::Save(input("", "计划"))).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"broken");
    }
}
