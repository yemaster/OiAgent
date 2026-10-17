//! Keep structured CLI settings out of shell/shim quoting, with one merged override.
use serde_json::{json, Value};
use std::{io::Write, path::Path};

pub fn checkpoint_settings() -> Value {
    json!({"general": {"fileCheckpointing": {"enabled": true}}})
}

fn merge(target: &mut Value, source: Value) {
    if let (Some(target), Some(source)) = (target.as_object_mut(), source.as_object()) {
        for (key, value) in source {
            merge(
                target.entry(key.clone()).or_insert(Value::Null),
                value.clone(),
            );
        }
    } else {
        *target = source;
    }
}

/// The caller retains the private file until the process exits. Never change
/// project/user settings, and never inspect text after the prompt separator.
pub fn prepare(
    kind: &str,
    project: &str,
    args: &mut Vec<String>,
    override_settings: Option<Value>,
) -> Result<Option<tempfile::NamedTempFile>, String> {
    if !matches!(kind, "claude" | "qodercn") {
        return Ok(None);
    }
    let mut settings = json!({});
    let mut found = false;
    let mut kept = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if arg == "--" {
            kept.extend_from_slice(&args[i..]);
            break;
        }
        let value = if arg == "--settings" {
            i += 1;
            Some(
                args.get(i)
                    .ok_or("--settings 缺少 JSON 或文件路径")?
                    .as_str(),
            )
        } else {
            arg.strip_prefix("--settings=")
        };
        if let Some(value) = value {
            let content = if value.trim_start().starts_with('{') {
                value.to_owned()
            } else {
                if value.is_empty() || value.starts_with('-') {
                    return Err("--settings 缺少 JSON 或文件路径".into());
                }
                let path = Path::new(project).join(value);
                let metadata =
                    std::fs::metadata(&path).map_err(|_| "无法读取 --settings 配置文件")?;
                if !metadata.is_file() || metadata.len() > 2 * 1024 * 1024 {
                    return Err("--settings 配置文件无效或超过 2 MB".into());
                }
                std::fs::read_to_string(path).map_err(|_| "无法读取 --settings 配置文件")?
            };
            let parsed: Value =
                json5::from_str(&content).map_err(|_| "--settings 配置不是有效的 JSON 对象")?;
            if !parsed.is_object() {
                return Err("--settings 配置必须是 JSON 对象".into());
            }
            merge(&mut settings, parsed);
            found = true;
        } else {
            kept.push(arg.clone());
        }
        i += 1;
    }
    if let Some(value) = override_settings {
        merge(&mut settings, value);
        found = true;
    }
    if !found {
        return Ok(None);
    }
    let mut file = tempfile::Builder::new()
        .prefix("oiagent-settings-")
        .suffix(".json")
        .tempfile()
        .map_err(|e| e.to_string())?;
    file.write_all(settings.to_string().as_bytes())
        .and_then(|_| file.flush())
        .map_err(|e| e.to_string())?;
    let index = kept
        .iter()
        .position(|arg| arg == "--")
        .unwrap_or(kept.len());
    kept.splice(
        index..index,
        [
            "--settings".into(),
            file.path().to_string_lossy().into_owned(),
        ],
    );
    *args = kept;
    Ok(Some(file))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn merges_settings_once_without_changing_files_or_prompt() {
        let project = tempfile::tempdir().unwrap();
        let original = r#"{ // native config supports comments
            "model": {"name": "custom model", "reasoningEffort":"low"},
            "general": {"fileCheckpointing":{"enabled":false}},
            "env": {"EXAMPLE":"quotes \" & %PATH% 中文"}
        }"#;
        std::fs::write(project.path().join("my settings.json"), original).unwrap();
        let prompt = "--settings {this is user text}";
        let mut args = vec![
            "-p".into(),
            "--settings".into(),
            "my settings.json".into(),
            r#"--settings={"model":{"reasoningEffort":"max"}}"#.into(),
            "--".into(),
            prompt.into(),
        ];
        let file = prepare(
            "qodercn",
            project.path().to_str().unwrap(),
            &mut args,
            Some(checkpoint_settings()),
        )
        .unwrap()
        .unwrap();
        assert_eq!(args.iter().filter(|a| *a == "--settings").count(), 1);
        assert_eq!(&args[args.len() - 2..], &["--", prompt]);
        let settings: Value = serde_json::from_slice(&std::fs::read(file.path()).unwrap()).unwrap();
        assert_eq!(settings["model"]["name"], "custom model");
        assert_eq!(settings["model"]["reasoningEffort"], "max");
        assert_eq!(settings["general"]["fileCheckpointing"]["enabled"], true);
        assert_eq!(
            std::fs::read_to_string(project.path().join("my settings.json")).unwrap(),
            original
        );
        let path = file.path().to_owned();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                std::fs::metadata(&path).unwrap().permissions().mode() & 0o077,
                0
            );
        }
        drop(file);
        assert!(!path.exists());
    }
    #[test]
    fn child_can_read_settings_while_parent_retains_private_file() {
        let node =
            crate::discovery::resolve(if cfg!(windows) { "node.exe" } else { "node" }).unwrap();
        let expected = json!({"model": {"name": "中文 model"}, "env": {"LITERAL": "%PATH% & $HOME \"quoted\""}});
        let mut args = vec!["--settings".into(), expected.to_string()];
        let guard = prepare("claude", ".", &mut args, None).unwrap().unwrap();
        let output = crate::process::agent_command(node)
            .unwrap()
            .args([
                "-e",
                "process.stdout.write(require('fs').readFileSync(process.argv[1], 'utf8'))",
            ])
            .arg(guard.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            serde_json::from_slice::<Value>(&output.stdout).unwrap(),
            expected
        );
    }
    #[test]
    fn invalid_settings_fail_before_launch_without_exposing_content() {
        for input in [
            vec!["--settings"],
            vec!["--settings", "--model"],
            vec!["--settings={\"secret\": broken"],
        ] {
            let mut args = input.iter().map(|s| s.to_string()).collect();
            let error = prepare("claude", ".", &mut args, None).err().unwrap();
            assert!(!error.contains("secret"));
        }
    }
}
