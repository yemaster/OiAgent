use crate::{integrations::atomic_write, store::AppState};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{io::Read, path::Path};
use tauri::State;
#[derive(Clone, Serialize, Deserialize)]
pub struct TaskTemplate {
    pub id: String,
    pub name: String,
    pub category: String,
    pub prompt: String,
}
#[derive(Serialize)]
pub struct TemplateLibrary {
    pub templates: Vec<TaskTemplate>,
    pub revision: String,
}
fn read(path: &Path) -> Result<TemplateLibrary, String> {
    let bytes = if path.exists() {
        let mut bytes = vec![];
        std::fs::File::open(path)
            .map_err(|e| e.to_string())?
            .take(4 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 {
            return Err("模板文件超过 4 MB".into());
        }
        bytes
    } else {
        include_bytes!("../../src/lib/task-template-defaults.json").to_vec()
    };
    Ok(TemplateLibrary {
        templates: serde_json::from_slice(&bytes).map_err(|_| "模板文件格式异常，原文件未修改")?,
        revision: format!("{:x}", Sha256::digest(&bytes)),
    })
}
fn save(
    path: &Path,
    mut template: TaskTemplate,
    expected: &str,
    remove: bool,
) -> Result<TemplateLibrary, String> {
    let mut library = read(path)?;
    if library.revision != expected {
        return Err("模板已被修改，请刷新列表后重试".into());
    }
    if remove {
        if !library.templates.iter().any(|t| t.id == template.id) {
            return Err("模板不存在".into());
        }
        library.templates.retain(|t| t.id != template.id);
    } else {
        template.name = template.name.trim().into();
        template.category = template.category.trim().into();
        if template.name.is_empty()
            || template.name.chars().count() > 80
            || template.category.chars().count() > 32
            || template.prompt.trim().is_empty()
            || template.prompt.len() > 32 * 1024
        {
            return Err(
                "请填写名称和 Prompt（名称最多 80 字，分类最多 32 字，Prompt 最多 32 KB）".into(),
            );
        }
        if template.id.is_empty() {
            template.id = uuid::Uuid::new_v4().to_string();
            library.templates.push(template);
        } else {
            let existing = library
                .templates
                .iter_mut()
                .find(|t| t.id == template.id)
                .ok_or("模板不存在，请重新创建")?;
            *existing = template;
        }
    }
    if library.templates.len() > 200 {
        return Err("最多保存 200 个模板".into());
    }
    let bytes = serde_json::to_vec_pretty(&library.templates).map_err(|e| e.to_string())?;
    if bytes.len() > 4 * 1024 * 1024 {
        return Err("模板总大小超过 4 MB".into());
    }
    atomic_write(path, &bytes)?;
    read(path)
}
#[tauri::command]
pub fn list_task_templates(state: State<AppState>) -> Result<TemplateLibrary, String> {
    let _lock = state.config_lock.lock().unwrap();
    read(&state.dir.join("task-templates.json"))
}
#[tauri::command]
pub fn save_task_template(
    state: State<AppState>,
    template: TaskTemplate,
    expected: String,
) -> Result<TemplateLibrary, String> {
    let _lock = state.config_lock.lock().unwrap();
    save(
        &state.dir.join("task-templates.json"),
        template,
        &expected,
        false,
    )
}
#[tauri::command]
pub fn remove_task_template(
    state: State<AppState>,
    id: String,
    expected: String,
) -> Result<TemplateLibrary, String> {
    let _lock = state.config_lock.lock().unwrap();
    save(
        &state.dir.join("task-templates.json"),
        TaskTemplate {
            id,
            name: String::new(),
            category: String::new(),
            prompt: String::new(),
        },
        &expected,
        true,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn edits_persist_and_stale_saves_cannot_overwrite() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().canonicalize().unwrap().join("templates.json");
        let initial = read(&path).unwrap();
        assert_eq!(initial.templates.len(), 4);
        let mut template = initial.templates[0].clone();
        template.prompt = "用户自定义的内容".into();
        let saved = save(&path, template.clone(), &initial.revision, false).unwrap();
        assert_eq!(read(&path).unwrap().templates[0].prompt, template.prompt);
        assert!(save(&path, template.clone(), &initial.revision, false).is_err());
        let deleted = save(&path, template, &saved.revision, true).unwrap();
        assert_eq!(deleted.templates.len(), 3);
    }
}
