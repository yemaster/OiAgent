use crate::{integrations::atomic_write, store::AppState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::Path,
};
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
    #[serde(default, rename = "parentId")]
    pub parent_id: Option<String>,
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
    #[serde(default, rename = "parentId")]
    pub parent_id: Option<String>,
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
    let items: Vec<Todo> =
        serde_json::from_slice(&bytes).map_err(|_| "计划文件格式异常，原文件未修改")?;
    validate_tree(&items)?;
    Ok(TodoList {
        items,
        revision: format!("{:x}", Sha256::digest(&bytes)),
    })
}

enum Change {
    Save(TodoInput),
    Complete { id: String, completed: bool },
    Remove(String),
}

fn descendants(items: &[Todo], id: &str) -> HashSet<String> {
    let mut result = HashSet::from([id.to_string()]);
    loop {
        let before = result.len();
        for item in items {
            if item.parent_id.as_ref().is_some_and(|p| result.contains(p)) {
                result.insert(item.id.clone());
            }
        }
        if before == result.len() {
            return result;
        }
    }
}

fn validate_tree(items: &[Todo]) -> Result<(), String> {
    let map: HashMap<_, _> = items.iter().map(|t| (t.id.as_str(), t)).collect();
    if map.len() != items.len() {
        return Err("计划 ID 重复".into());
    }
    for item in items {
        let mut seen = HashSet::from([item.id.as_str()]);
        let mut parent = item.parent_id.as_deref();
        while let Some(id) = parent {
            if !seen.insert(id) {
                return Err("不能将计划移入自身或其子计划".into());
            }
            if seen.len() > 5 {
                return Err("计划最多支持 5 层，请选择其他父计划".into());
            }
            parent = map
                .get(id)
                .ok_or("父计划不存在，请刷新列表")?
                .parent_id
                .as_deref();
        }
    }
    Ok(())
}

fn reopen_ancestors(items: &mut [Todo], id: &str, now: &str) {
    let mut current = Some(id.to_string());
    let mut seen = HashSet::new();
    while let Some(id) = current {
        if !seen.insert(id.clone()) {
            break;
        }
        let Some(item) = items.iter_mut().find(|t| t.id == id) else {
            break;
        };
        if item.completed_at.take().is_some() {
            item.updated_at = now.into();
        }
        current = item.parent_id.clone();
    }
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
                    parent_id: input.parent_id,
                    created_at: now.clone(),
                    updated_at: now.clone(),
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
                item.parent_id = input.parent_id;
                item.updated_at = now.clone();
            }
        }
        Change::Complete { id, completed } => {
            if !list.items.iter().any(|t| t.id == id) {
                return Err("计划不存在，请刷新列表".into());
            }
            if completed {
                let affected = descendants(&list.items, &id);
                for item in &mut list.items {
                    if affected.contains(&item.id) && item.completed_at.is_none() {
                        item.completed_at = Some(now.clone());
                        item.updated_at = now.clone();
                    }
                }
            } else {
                reopen_ancestors(&mut list.items, &id, &now);
            }
        }
        Change::Remove(id) => {
            if !list.items.iter().any(|t| t.id == id) {
                return Err("计划不存在，请刷新列表".into());
            }
            let parent = list
                .items
                .iter()
                .find(|t| t.id == id)
                .and_then(|t| t.parent_id.clone());
            for item in &mut list.items {
                if item.parent_id.as_deref() == Some(&id) {
                    item.parent_id = parent.clone();
                    item.updated_at = now.clone();
                }
            }
            list.items.retain(|t| t.id != id);
        }
    }
    validate_tree(&list.items)?;
    let unfinished: Vec<_> = list
        .items
        .iter()
        .filter(|t| t.completed_at.is_none())
        .map(|t| t.id.clone())
        .collect();
    for id in unfinished {
        reopen_ancestors(&mut list.items, &id, &now);
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
            parent_id: None,
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

    fn save_input(path: &Path, input: TodoInput) -> TodoList {
        change(path, &read(path).unwrap().revision, Change::Save(input)).unwrap()
    }
    #[test]
    fn hierarchy_completes_reopens_and_preserves_children_on_delete() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("todos.json");
        let first = save_input(&path, input("", "父计划"));
        let parent = first.items[0].id.clone();
        let mut child_input = input("", "子计划");
        child_input.parent_id = Some(parent.clone());
        let second = save_input(&path, child_input);
        let child = second.items[1].id.clone();
        let mut grandchild_input = input("", "孙计划");
        grandchild_input.parent_id = Some(child.clone());
        let third = save_input(&path, grandchild_input);
        let grandchild = third.items[2].id.clone();
        let mut cycle = input(&parent, "循环");
        cycle.parent_id = Some(grandchild.clone());
        assert!(change(&path, &third.revision, Change::Save(cycle)).is_err());
        assert_eq!(read(&path).unwrap().revision, third.revision);
        let done = change(
            &path,
            &third.revision,
            Change::Complete {
                id: parent.clone(),
                completed: true,
            },
        )
        .unwrap();
        assert!(done.items.iter().all(|t| t.completed_at.is_some()));
        let open = change(
            &path,
            &done.revision,
            Change::Complete {
                id: grandchild.clone(),
                completed: false,
            },
        )
        .unwrap();
        assert!(open.items.iter().all(|t| t.completed_at.is_none()));
        let removed = change(&path, &open.revision, Change::Remove(child)).unwrap();
        assert_eq!(
            removed
                .items
                .iter()
                .find(|t| t.id == grandchild)
                .unwrap()
                .parent_id
                .as_ref(),
            Some(&parent)
        );
        let done = change(
            &path,
            &removed.revision,
            Change::Complete {
                id: parent.clone(),
                completed: true,
            },
        )
        .unwrap();
        let mut new_child = input("", "新增工作");
        new_child.parent_id = Some(parent.clone());
        let added = change(&path, &done.revision, Change::Save(new_child)).unwrap();
        assert!(added
            .items
            .iter()
            .find(|t| t.id == parent)
            .unwrap()
            .completed_at
            .is_none());
        assert!(added
            .items
            .iter()
            .find(|t| t.id == grandchild)
            .unwrap()
            .completed_at
            .is_some());
    }

    #[test]
    fn migrates_flat_plans_and_checks_subtree_depth_on_moves() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().canonicalize().unwrap().join("todos.json");
        std::fs::write(&path, r#"[{"id":"legacy","title":"旧计划","notes":"","project":"","important":false,"createdAt":"","updatedAt":"","completedAt":null}]"#).unwrap();
        assert!(read(&path).unwrap().items[0].parent_id.is_none());
        let mut last = "legacy".to_string();
        for _ in 0..4 {
            let mut next = input("", "子计划");
            next.parent_id = Some(last);
            last = save_input(&path, next).items.last().unwrap().id.clone();
        }
        let current = read(&path).unwrap();
        let mut too_deep = input("", "第六层");
        too_deep.parent_id = Some(last.clone());
        assert!(change(&path, &current.revision, Change::Save(too_deep)).is_err());
        let mut missing = input("", "不存在的父计划");
        missing.parent_id = Some("missing".into());
        assert!(change(&path, &current.revision, Change::Save(missing)).is_err());
        let extra = save_input(&path, input("", "其他父计划"));
        let extra_id = extra.items.last().unwrap().id.clone();
        let mut move_subtree = input("legacy", "旧计划");
        move_subtree.parent_id = Some(extra_id);
        assert!(change(&path, &extra.revision, Change::Save(move_subtree)).is_err());
        assert_eq!(read(&path).unwrap().revision, extra.revision);
    }
}
