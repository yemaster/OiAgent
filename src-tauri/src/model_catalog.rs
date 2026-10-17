//! Read-only model discovery. No thread/turn or user prompt is sent to an Agent.
use crate::{discovery, models::Agent, store::AppState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    process::{Child, ChildStdin, Stdio},
    sync::mpsc::{self, Receiver},
    time::{Duration, Instant},
};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub models: Vec<Model>,
    pub default_model: String,
    pub default_effort: String,
    pub default_service_tier: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub value: String,
    pub label: String,
    pub aliases: Vec<String>,
    pub efforts: Vec<String>,
    pub default_effort: String,
    pub service_tiers: Vec<Choice>,
    pub context_windows: Vec<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Choice {
    pub value: String,
    pub label: String,
}
fn text(value: &Value) -> String {
    value.as_str().unwrap_or("").chars().take(240).collect()
}
fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 80 && !s.chars().any(char::is_control))
        .take(32)
        .map(str::to_owned)
        .collect()
}
pub fn parse_models(value: &Value, kind: &str) -> Vec<Model> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(256)
        .filter_map(|m| {
            if m["hidden"] == true || m["isEnabled"] == false {
                return None;
            }
            let id = m["model"]
                .as_str()
                .or_else(|| m["value"].as_str())
                .or_else(|| m["id"].as_str())?;
            let label = m["displayName"]
                .as_str()
                .or_else(|| m["label"].as_str())
                .unwrap_or(id);
            // Qoder CLI accepts display names for built-ins and model IDs for BYOK.
            let id = if kind == "qodercn"
                && m["source"] == "system"
                && !["auto", "fast"].contains(&id)
            {
                label
            } else {
                id
            };
            if id.is_empty() || id.len() > 240 || id.chars().any(char::is_control) {
                return None;
            }
            let mut efforts = if kind == "codex" {
                strings(&Value::Array(
                    m["supportedReasoningEfforts"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|v| v["reasoningEffort"].clone())
                        .collect(),
                ))
            } else if kind == "qodercn" {
                let explicit = strings(&m["efforts"]);
                if explicit.is_empty() {
                    m["thinking_config"]["enabled"]["efforts"]
                        .as_object()
                        .into_iter()
                        .flat_map(|v| v.keys().cloned())
                        .take(32)
                        .collect()
                } else {
                    explicit
                }
            } else {
                vec![]
            };
            if kind == "qodercn"
                && (m["supportsDisabled"] == true || m["thinking_config"].get("disabled").is_some())
                && !efforts.iter().any(|v| v == "disabled")
            {
                efforts.push("disabled".into());
            }
            let mut default_effort = text(
                m.get("defaultReasoningEffort")
                    .unwrap_or(&m["defaultEffort"]),
            );
            if default_effort.is_empty() && kind == "qodercn" {
                default_effort = m["thinking_config"]["enabled"]["efforts"]
                    .as_object()
                    .into_iter()
                    .flat_map(|v| v.iter())
                    .find(|(_, v)| v["is_default"] == true)
                    .map(|(k, _)| k.clone())
                    .unwrap_or_default();
            }
            let mut service_tiers = vec![];
            if kind == "codex" {
                for tier in m["serviceTiers"].as_array().into_iter().flatten().take(16) {
                    let value = text(&tier["id"]);
                    if !value.is_empty() {
                        service_tiers.push(Choice {
                            label: tier["name"].as_str().unwrap_or(&value).into(),
                            value,
                        });
                    }
                }
                if service_tiers.is_empty()
                    && strings(&m["additionalSpeedTiers"])
                        .iter()
                        .any(|v| v == "fast")
                {
                    service_tiers.push(Choice {
                        value: "fast".into(),
                        label: "Fast".into(),
                    });
                }
            }
            Some(Model {
                value: id.into(),
                label: label.chars().take(240).collect(),
                aliases: ["value", "id", "modelId"]
                    .iter()
                    .filter_map(|key| m[*key].as_str())
                    .filter(|v| v.len() <= 240)
                    .map(str::to_owned)
                    .collect(),
                efforts,
                default_effort,
                service_tiers,
                context_windows: if kind == "qodercn" {
                    m["availableContextWindows"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_u64)
                        .filter(|n| *n > 0)
                        .take(16)
                        .collect()
                } else {
                    vec![]
                },
            })
        })
        .collect()
}

// Bound the process lifetime and output, including on protocol errors and early returns.
struct Probe {
    child: Child,
    input: ChildStdin,
    output: Receiver<String>,
    deadline: Instant,
}
impl Drop for Probe {
    fn drop(&mut self) {
        crate::process::terminate_background(&mut self.child);
        let _ = self.child.wait();
    }
}
impl Probe {
    fn start(
        agent: &Agent,
        project: &str,
        args: &[&str],
    ) -> Result<(Self, Option<tempfile::NamedTempFile>), String> {
        let executable = discovery::resolve(&agent.executable).ok_or("找不到 Agent 程序")?;
        let mut command = crate::process::agent_command(executable)?;
        command
            .args(args)
            .env("PATH", discovery::path_env())
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if !project.is_empty() {
            command.current_dir(project);
        }
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        let auth = if agent.kind == "qodercn" {
            Some(crate::qodercn::prepare_sdk(
                &mut command,
                &Default::default(),
            )?)
        } else {
            None
        };
        let mut child = command.spawn().map_err(|_| "无法读取 Agent 模型列表")?;
        let input = child.stdin.take().ok_or("Agent 输入通道不可用")?;
        let stdout = child.stdout.take().ok_or("Agent 输出通道不可用")?;
        let (tx, output) = mpsc::channel();
        std::thread::spawn(move || {
            // One bounded reader; no stderr or raw config ever crosses the IPC boundary.
            for line in BufReader::new(stdout.take(2 * 1024 * 1024)).lines() {
                let Ok(line) = line else { break };
                if tx.send(line).is_err() {
                    break;
                }
            }
        });
        Ok((
            Self {
                child,
                input,
                output,
                deadline: Instant::now() + Duration::from_secs(20),
            },
            auth,
        ))
    }
    fn send(&mut self, value: Value) -> Result<(), String> {
        writeln!(self.input, "{value}")
            .and_then(|_| self.input.flush())
            .map_err(|_| "Agent 连接已关闭".into())
    }
    fn receive(&self) -> Result<Value, String> {
        loop {
            let line = self
                .output
                .recv_timeout(self.deadline.saturating_duration_since(Instant::now()))
                .map_err(|_| "未能获取模型列表，请确认 Agent 已登录后重试")?;
            if let Ok(value) = serde_json::from_str(&line) {
                return Ok(value);
            }
        }
    }
    fn rpc(&mut self, id: u32, method: &str, params: Value) -> Result<Value, String> {
        self.send(json!({"id":id,"method":method,"params":params}))?;
        loop {
            let value = self.receive()?;
            if value["id"] == id {
                if value.get("error").is_some() {
                    return Err("当前 CLI 无法提供模型配置，请更新程序或手动填写模型".into());
                }
                return Ok(value["result"].clone());
            }
        }
    }
}
fn discover(agent: &Agent, project: &str) -> Result<Catalog, String> {
    match agent.kind.as_str() {
        "codex" => {
            let (mut probe, _auth) = Probe::start(agent, project, &["app-server"])?;
            probe.rpc(1, "initialize", json!({"clientInfo":{"name":"oiagent","version":env!("CARGO_PKG_VERSION")},"capabilities":{"experimentalApi":true}}))?;
            probe.send(json!({"method":"initialized"}))?;
            let mut catalog = Catalog::default();
            let mut cursor = Value::Null;
            for page in 0..8 {
                let result = probe.rpc(
                    2 + page,
                    "model/list",
                    json!({"limit":100,"includeHidden":false,"cursor":cursor}),
                )?;
                if catalog.default_model.is_empty() {
                    catalog.default_model = result["data"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|m| m["isDefault"] == true)
                        .map(|m| text(&m["model"]))
                        .unwrap_or_default();
                }
                catalog
                    .models
                    .extend(parse_models(&result["data"], "codex"));
                cursor = result["nextCursor"].clone();
                if cursor.is_null() {
                    break;
                }
            }
            // Whitelist only display fields; config/read may contain provider credentials.
            if let Ok(result) = probe.rpc(20, "config/read", json!({"includeLayers":false,"cwd":if project.is_empty() { Value::Null } else { json!(project) }})) {
                let c = &result["config"];
                if c["model"].as_str().is_some_and(|v| !v.is_empty()) { catalog.default_model = text(&c["model"]); }
                catalog.default_effort = text(&c["model_reasoning_effort"]);
                catalog.default_service_tier = text(&c["service_tier"]);
            }
            Ok(catalog)
        }
        "qodercn" | "qwen" => {
            let args: &[&str] = if agent.kind == "qodercn" {
                &[
                    "-p",
                    "--input-format",
                    "stream-json",
                    "--output-format",
                    "stream-json",
                ]
            } else {
                &[
                    "--input-format",
                    "stream-json",
                    "--output-format",
                    "stream-json",
                    "--channel=SDK",
                ]
            };
            let (mut probe, _auth) = Probe::start(agent, project, args)?;
            let request = if agent.kind == "qodercn" {
                json!({"type":"initialize","hooks":{}})
            } else {
                json!({"subtype":"initialize","hooks":null})
            };
            probe.send(
                json!({"type":"control_request","request_id":"oiagent-models","request":request}),
            )?;
            loop {
                let v = probe.receive()?;
                if v["type"] == "control_response"
                    && v["response"]["request_id"] == "oiagent-models"
                {
                    if v["response"]["subtype"] != "success" {
                        return Err("当前 CLI 无法提供模型列表".into());
                    }
                    let mut data = v["response"]["response"].clone();
                    if agent.kind == "qwen"
                        && data["capabilities"]["can_get_available_models"] == true
                    {
                        probe.send(json!({"type":"control_request","request_id":"oiagent-available-models","request":{"subtype":"get_available_models"}}))?;
                        loop {
                            let result = probe.receive()?;
                            if result["response"]["request_id"] == "oiagent-available-models" {
                                data = result["response"]["response"].clone();
                                break;
                            }
                        }
                    }
                    let mut catalog = Catalog {
                        models: parse_models(&data["models"], &agent.kind),
                        ..Default::default()
                    };
                    if agent.kind == "qodercn" {
                        // Match documented precedence without exposing any other settings.
                        if let Some(home) = dirs::home_dir() {
                            let mut paths =
                                vec![crate::qodercn::config_root(&home).join("settings.json")];
                            if !project.is_empty() {
                                paths.extend(
                                    ["settings.json", "settings.local.json"].map(|n| {
                                        std::path::Path::new(project).join(".qoder").join(n)
                                    }),
                                );
                            }
                            for path in paths {
                                let Some(c) = std::fs::File::open(path).ok().and_then(|f| {
                                    serde_json::from_reader::<_, Value>(f.take(512 * 1024)).ok()
                                }) else {
                                    continue;
                                };
                                if c["model"]["name"].is_string() {
                                    catalog.default_model = text(&c["model"]["name"]);
                                }
                                if c["model"]["reasoningEffort"].is_string() {
                                    catalog.default_effort = text(&c["model"]["reasoningEffort"]);
                                }
                            }
                        }
                        if catalog.default_model.is_empty() {
                            catalog.default_model = "auto".into();
                        }
                    }
                    return Ok(catalog);
                }
            }
        }
        "opencode" => {
            let (probe, _auth) = Probe::start(agent, project, &["models"])?;
            let mut catalog = Catalog::default();
            while let Ok(line) = probe
                .output
                .recv_timeout(probe.deadline.saturating_duration_since(Instant::now()))
            {
                let id = line.trim();
                if id.contains('/')
                    && id.len() <= 240
                    && !id.chars().any(|c| c.is_whitespace() || c.is_control())
                {
                    catalog.models.push(Model {
                        value: id.into(),
                        label: id.into(),
                        ..Default::default()
                    });
                }
                if catalog.models.len() >= 256 {
                    break;
                }
            }
            if catalog.models.is_empty() {
                return Err("未能获取模型列表，请手动填写模型".into());
            }
            Ok(catalog)
        }
        _ => Ok(Catalog::default()),
    }
}
#[tauri::command]
pub async fn agent_models(
    state: tauri::State<'_, AppState>,
    agent_id: String,
    project: Option<String>,
) -> Result<Catalog, String> {
    let agent = state
        .db
        .lock()
        .unwrap()
        .agents
        .iter()
        .find(|a| a.id == agent_id && a.available && !a.custom)
        .cloned()
        .ok_or("Agent 不可用")?;
    tauri::async_runtime::spawn_blocking(move || discover(&agent, project.as_deref().unwrap_or("")))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn codex_uses_advertised_models_efforts_and_tiers_without_exposing_config() {
        let models = parse_models(
            &json!([
                {"model":"future-model","displayName":"Future","supportedReasoningEfforts":[{"reasoningEffort":"medium"},{"reasoningEffort":"ultra"}],"defaultReasoningEffort":"medium","serviceTiers":[{"id":"priority","name":"Fast"}],"apiKey":"secret"},
                {"model":"hidden","hidden":true},
                {"model":"old","additionalSpeedTiers":["fast"]},
                {"model":"disabled","isEnabled":false}
            ]),
            "codex",
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0].efforts, ["medium", "ultra"]);
        assert_eq!(models[0].service_tiers[0].value, "priority");
        assert_eq!(models[1].service_tiers[0].value, "fast");
        assert!(!serde_json::to_string(&models).unwrap().contains("secret"));
    }
    #[test]
    fn qoder_preserves_native_names_and_per_model_options() {
        let models = parse_models(
            &json!([
                {"value":"internal","displayName":"Model A","source":"system","efforts":["low","max"],"defaultEffort":"max","availableContextWindows":[200000,400000]},
                {"value":"byok-id","displayName":"My model","source":"custom"},
                {"value":"fast","displayName":"Fast","source":"system"}
            ]),
            "qodercn",
        );
        assert_eq!(models[0].value, "Model A");
        assert_eq!(models[0].efforts, ["low", "max"]);
        assert_eq!(models[0].context_windows, [200000, 400000]);
        assert!(models[0].service_tiers.is_empty());
        assert_eq!(models[1].value, "byok-id");
        assert!(models[1].efforts.is_empty());
        assert_eq!(models[2].value, "fast");
    }
}
