//! Stored project identities use the same Windows-safe representation as new tasks.
//! `dunce` preserves verbatim paths when stripping the prefix would change their meaning.
use crate::models::Database;
use std::{collections::HashSet, path::Path};

pub fn normalize(path: &str) -> String {
    dunce::simplified(Path::new(path))
        .to_string_lossy()
        .into_owned()
}
pub fn normalize_database(db: &mut Database) {
    let mut seen = HashSet::new();
    db.projects = db
        .projects
        .iter()
        .map(|p| normalize(p))
        .filter(|p| seen.insert(p.clone()))
        .collect();
    for task in &mut db.tasks {
        task.project = normalize(&task.project);
    }
    for run in &mut db.workflow_runs {
        run.project = normalize(&run.project);
    }
    for project in &mut db.temporary_projects {
        project.path = normalize(&project.path);
    }
    // Preserve pins/colors when an old verbatim key and a plain key both exist.
    let mut marks: Vec<_> = std::mem::take(&mut db.workspace_marks)
        .into_iter()
        .collect();
    marks.sort_by(|a, b| a.0.cmp(&b.0));
    for (key, mark) in marks {
        let normalized = key
            .strip_prefix("project:")
            .and_then(|json| serde_json::from_str::<[String; 2]>(json).ok())
            .filter(|parts| parts[0] == "local")
            .map(|parts| {
                format!(
                    "project:{}",
                    serde_json::json!([parts[0], normalize(&parts[1])])
                )
            })
            .unwrap_or(key);
        let entry = db.workspace_marks.entry(normalized).or_default();
        entry.pinned |= mark.pinned;
        if entry.color.is_none() {
            entry.color = mark.color;
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_project_paths_remain_usable() {
        let directory = tempfile::tempdir().unwrap();
        let canonical = dunce::canonicalize(directory.path()).unwrap();
        let path = canonical.to_string_lossy().into_owned();
        assert_eq!(normalize(&path), path);
        assert!(Path::new(&normalize(&path)).is_dir());
        let mut db = Database {
            projects: vec![path.clone(), path.clone()],
            ..Default::default()
        };
        normalize_database(&mut db);
        assert_eq!(db.projects, [path]);
    }
    #[cfg(windows)]
    #[test]
    fn verbatim_projects_and_history_share_one_identity_without_losing_marks() {
        let plain = r"E:\Works\Project2";
        let extended = r"\\?\E:\Works\Project2";
        assert_eq!(normalize(extended), plain);
        let mut db = Database {
            projects: vec![plain.into(), extended.into()],
            ..Default::default()
        };
        let key = |path: &str| format!("project:{}", serde_json::json!(["local", path]));
        db.workspace_marks.insert(
            key(plain),
            crate::organization::ItemMark {
                pinned: false,
                color: Some("blue".into()),
            },
        );
        db.workspace_marks.insert(
            key(extended),
            crate::organization::ItemMark {
                pinned: true,
                color: None,
            },
        );
        normalize_database(&mut db);
        assert_eq!(db.projects, [plain]);
        assert_eq!(db.workspace_marks.len(), 1);
        assert!(db.workspace_marks[&key(plain)].pinned);
        assert_eq!(
            db.workspace_marks[&key(plain)].color.as_deref(),
            Some("blue")
        );
        assert_eq!(normalize(r"\\?\E:\Works\CON"), r"\\?\E:\Works\CON");
        assert_eq!(
            normalize(r"\\server\share\project"),
            r"\\server\share\project"
        );
    }
}
