//! Per-message model tuning; unrelated launch arguments remain untouched.
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOptions {
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub service_tier: String,
    #[serde(default)]
    pub context_window: Option<u64>,
}
impl ModelOptions {
    pub fn validate(&self, kind: &str) -> Result<(), String> {
        for value in [&self.effort, &self.service_tier] {
            if value.len() > 80
                || !value
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
            {
                return Err("模型参数无效".into());
            }
        }
        if (!self.effort.is_empty() && !["codex", "qodercn"].contains(&kind))
            || (!self.service_tier.is_empty() && kind != "codex")
            || (self.context_window.is_some() && kind != "qodercn")
            || self
                .context_window
                .is_some_and(|n| n == 0 || n > 100_000_000)
        {
            return Err("此 Agent 不支持所选模型参数".into());
        }
        Ok(())
    }
    pub fn apply(&self, kind: &str, args: &[String]) -> Vec<String> {
        let mut result = vec![];
        let mut i = 0;
        while i < args.len() {
            let arg = &args[i];
            let config = if arg == "-c" || arg == "--config" {
                args.get(i + 1).map(String::as_str)
            } else {
                arg.strip_prefix("--config=")
                    .or_else(|| arg.strip_prefix("-c").filter(|s| !s.is_empty()))
            };
            let managed = (kind == "codex"
                && config.is_some_and(|v| {
                    matches!(
                        v.split('=').next().unwrap_or("").trim(),
                        "model_reasoning_effort" | "service_tier"
                    )
                }))
                || (kind == "qodercn"
                    && matches!(
                        arg.split('=').next().unwrap_or(""),
                        "--reasoning-effort" | "--context-window"
                    ));
            if managed {
                i += if arg == "-c"
                    || arg == "--config"
                    || arg == "--reasoning-effort"
                    || arg == "--context-window"
                {
                    2
                } else {
                    1
                };
            } else {
                result.push(arg.clone());
                i += 1;
            }
        }
        if kind == "codex" {
            for (key, value) in [
                ("model_reasoning_effort", &self.effort),
                ("service_tier", &self.service_tier),
            ] {
                if !value.is_empty() {
                    result.extend([
                        "-c".into(),
                        format!("{key}={}", serde_json::to_string(value).unwrap()),
                    ]);
                }
            }
        } else if kind == "qodercn" {
            if !self.effort.is_empty() {
                result.extend(["--reasoning-effort".into(), self.effort.clone()]);
            }
            if let Some(window) = self.context_window {
                result.extend(["--context-window".into(), window.to_string()]);
            }
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_only_model_tuning_and_keeps_the_last_explicit_choice() {
        let options = ModelOptions {
            effort: "high".into(),
            service_tier: "priority".into(),
            ..Default::default()
        };
        let args = [
            "-c",
            "model_reasoning_effort=\"low\"",
            "--config=service_tier=\"fast\"",
            "-c",
            "foo=1",
        ]
        .map(String::from);
        assert_eq!(
            options.apply("codex", &args),
            [
                "-c",
                "foo=1",
                "-c",
                "model_reasoning_effort=\"high\"",
                "-c",
                "service_tier=\"priority\""
            ]
        );
        assert_eq!(
            ModelOptions::default().apply("codex", &args),
            ["-c", "foo=1"]
        );
        assert!(options.validate("qodercn").is_err());
        let options = ModelOptions {
            effort: "max".into(),
            context_window: Some(400000),
            ..Default::default()
        };
        assert_eq!(
            options.apply(
                "qodercn",
                &[
                    "--reasoning-effort=high".into(),
                    "--attachment".into(),
                    "a.png".into()
                ]
            ),
            [
                "--attachment",
                "a.png",
                "--reasoning-effort",
                "max",
                "--context-window",
                "400000"
            ]
        );
    }
}
