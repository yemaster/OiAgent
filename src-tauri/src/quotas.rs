//! Account limits only; token totals and context-window usage are not quotas.
//! Codex app-server account/rateLimits/read; Qoder SDK get_usage_info.
use crate::{models::Agent, store::AppState};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read, Write},
    process::Stdio,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::Manager;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    label: String,
    used_percent: f64,
    resets_at: Option<i64>,
    remaining: Option<f64>,
    unit: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quota {
    windows: Vec<Window>,
    updated_at: i64,
}
#[derive(Default)]
pub struct Cache {
    at: Option<Instant>,
    value: Option<Quota>,
}
pub type Caches = Mutex<HashMap<String, Arc<Mutex<Cache>>>>;
fn percent(v: &Value) -> Option<f64> {
    v.as_f64()
        .filter(|v| v.is_finite() && *v >= 0.0 && *v <= 100.0)
}
fn now() -> i64 {
    chrono::Utc::now().timestamp()
}
fn quota(windows: Vec<Window>) -> Option<Quota> {
    let windows: Vec<_> = windows
        .into_iter()
        .filter(|w| w.resets_at.is_none_or(|t| t > now()))
        .collect();
    (!windows.is_empty()).then(|| Quota {
        windows,
        updated_at: now(),
    })
}
fn codex(value: &Value) -> Option<Quota> {
    let buckets: Vec<_> = match value["rateLimitsByLimitId"]
        .as_object()
        .filter(|m| !m.is_empty())
    {
        Some(map) => map.values().collect(),
        None => vec![&value["rateLimits"]],
    };
    quota(
        buckets
            .into_iter()
            .take(8)
            .flat_map(|bucket| {
                ["primary", "secondary"].into_iter().filter_map(move |key| {
                    let w = &bucket[key];
                    let used_percent = percent(&w["usedPercent"])?;
                    let label = match w["windowDurationMins"].as_u64() {
                        Some(10080) => "每周".into(),
                        Some(n) if n > 0 && n % 60 == 0 => format!("{} 小时", n / 60),
                        Some(n) if n > 0 => format!("{n} 分钟"),
                        _ => if key == "primary" {
                            "当前配额"
                        } else {
                            "长期配额"
                        }
                        .into(),
                    };
                    let prefix = bucket["limitName"]
                        .as_str()
                        .filter(|s| !s.is_empty())
                        .unwrap_or("");
                    Some(Window {
                        label: if prefix.is_empty() {
                            label
                        } else {
                            format!("{prefix} · {label}")
                        },
                        used_percent,
                        resets_at: w["resetsAt"].as_i64(),
                        remaining: None,
                        unit: None,
                    })
                })
            })
            .collect(),
    )
}
fn qoder(value: &Value) -> Option<Quota> {
    let usage = &value["usage"];
    quota(
        [
            ("userQuota", "套餐"),
            ("addOnQuota", "加量包"),
            ("orgResourcePackage", "组织额度"),
        ]
        .into_iter()
        .filter_map(|(key, label)| {
            let w = &usage[key];
            if w["available"] == false {
                return None;
            }
            let used_percent = percent(&w["percentage"])?;
            Some(Window {
                label: label.into(),
                used_percent,
                resets_at: None,
                remaining: w["remaining"]
                    .as_f64()
                    .filter(|v| v.is_finite() && *v >= 0.0),
                unit: w["unit"].as_str().map(|s| s.chars().take(30).collect()),
            })
        })
        .collect(),
    )
}
// A metadata-only handshake. Never send a user prompt, start a thread/turn,
// allow a tool request, scrape auth files, or call undocumented web endpoints.
fn probe(agent: &Agent) -> Option<Quota> {
    let executable = crate::discovery::resolve(&agent.executable)?;
    let mut command = crate::process::background_command(executable);
    let is_codex = agent.kind == "codex";
    let _auth = if is_codex {
        command.arg("app-server");
        None
    } else {
        command.args([
            "--print",
            "--output-format",
            "stream-json",
            "--input-format",
            "stream-json",
            "--no-session-persistence",
        ]);
        Some(crate::qodercn::prepare_sdk(&mut command, &Default::default()).ok()?)
    };
    // Private empty cwd prevents project hooks/settings from affecting a query.
    let cwd = tempfile::tempdir().ok()?;
    command
        .current_dir(cwd.path())
        .env("PATH", crate::discovery::path_env())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    exchange(command.spawn().ok()?, is_codex, Duration::from_secs(8))
}
fn exchange(mut child: std::process::Child, is_codex: bool, timeout: Duration) -> Option<Quota> {
    let stdout = child.stdout.take()?;
    let (tx, rx) = std::sync::mpsc::sync_channel(32);
    // Bound total output and every frame; read in a worker so a stalled CLI
    // cannot block the deadline. Receiver is dropped before killing the child.
    let reader = std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout.take(1024 * 1024));
        loop {
            let mut bytes = Vec::new();
            let Ok(n) = reader
                .by_ref()
                .take(128 * 1024)
                .read_until(b'\n', &mut bytes)
            else {
                break;
            };
            if n == 0 || bytes.last() != Some(&b'\n') {
                break;
            }
            if let Ok(value) = serde_json::from_slice::<Value>(&bytes) {
                if tx.send(value).is_err() {
                    break;
                }
            }
        }
    });
    let result = (|| {
        let mut input = child.stdin.take()?;
        let mut send = |v: Value| writeln!(input, "{v}").ok();
        if is_codex {
            send(
                json!({"id":1,"method":"initialize","params":{"clientInfo":{"name":"oiagent","title":"OiAgent","version":env!("CARGO_PKG_VERSION")}}}),
            )?;
        } else {
            send(
                json!({"type":"control_request","request_id":"quota-init","request":{"type":"initialize","hooks":{}}}),
            )?;
        }
        let deadline = Instant::now() + timeout;
        let mut ready = false;
        loop {
            let value = rx
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .ok()?;
            if is_codex {
                if value["id"] == 1 && !ready {
                    value.get("result")?;
                    send(json!({"method":"initialized","params":{}}))?;
                    send(json!({"id":2,"method":"account/rateLimits/read","params":{}}))?;
                    ready = true;
                } else if value["id"] == 2 {
                    return codex(&value["result"]);
                }
            } else if value["type"] == "control_response" {
                let response = &value["response"];
                if response["request_id"] == "quota-init" && !ready {
                    if response["subtype"] != "success" {
                        return None;
                    }
                    send(
                        json!({"type":"control_request","request_id":"quota-read","request":{"type":"get_usage_info"}}),
                    )?;
                    ready = true;
                } else if response["request_id"] == "quota-read" {
                    return qoder(&response["response"]);
                }
            }
        }
    })();
    drop(rx);
    // The root may already have exited while a descendant still holds stdout.
    #[cfg(unix)]
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    crate::process::terminate_background(&mut child);
    let _ = child.wait();
    // Do not block on a descendant that inherited stdout after the CLI exited.
    if reader.is_finished() {
        let _ = reader.join();
    }
    result
}
#[tauri::command]
pub async fn agent_quota(app: tauri::AppHandle, id: String) -> Result<Option<Quota>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let agent = state
            .db
            .lock()
            .map_err(|e| e.to_string())?
            .agents
            .iter()
            .find(|a| a.id == id)
            .cloned()
            .ok_or("Agent 不存在")?;
        if !agent.available
            || agent.custom
            || !matches!(agent.kind.as_str(), "codex" | "qodercn" | "claude")
        {
            return Ok(None);
        }
        let key = format!("{}:{}:{}", agent.id, agent.executable, agent.version);
        let cache = state.quotas.lock().unwrap().entry(key).or_default().clone();
        let mut cached = cache.lock().unwrap(); // Per-agent lock coalesces duplicate requests.
        if agent.kind == "claude" {
            return Ok(cached
                .at
                .filter(|at| at.elapsed() < Duration::from_secs(600))
                .and_then(|_| cached.value.clone())
                .and_then(|q| {
                    let mut filtered = quota(q.windows)?;
                    filtered.updated_at = q.updated_at;
                    Some(filtered)
                }));
        }
        if cached
            .at
            .is_none_or(|at| at.elapsed() >= Duration::from_secs(60))
        {
            cached.value = probe(&agent);
            cached.at = Some(Instant::now());
        }
        Ok(cached.value.clone().and_then(|q| {
            let mut filtered = quota(q.windows)?;
            filtered.updated_at = q.updated_at;
            Some(filtered)
        }))
    })
    .await
    .map_err(|e| e.to_string())?
}
// Claude only publishes some limits during a real task. Missing utilization is
// unknown, not zero. Never mix custom API provider limits with local account data.
pub fn observe(state: &AppState, task_id: &str, value: &Value) {
    if value["type"] != "rate_limit_event" {
        return;
    }
    let agent = {
        let db = state.db.lock().unwrap();
        let Some(task) = db
            .tasks
            .iter()
            .find(|t| t.id == task_id && t.agent_kind == "claude" && t.provider_id.is_none())
        else {
            return;
        };
        let Some(agent) = db
            .agents
            .iter()
            .find(|a| a.id == task.agent_id && !a.custom)
        else {
            return;
        };
        agent.clone()
    };
    let info = &value["rate_limit_info"];
    let Some(utilization) = info["utilization"]
        .as_f64()
        .filter(|v| v.is_finite() && (0.0..=1.0).contains(v))
    else {
        return;
    };
    let label = match info["rateLimitType"].as_str() {
        Some("five_hour") => "5 小时",
        Some("seven_day") => "每周",
        Some("seven_day_opus") => "Opus · 每周",
        Some("seven_day_sonnet") => "Sonnet · 每周",
        _ => return,
    };
    let Some(data) = quota(vec![Window {
        label: label.into(),
        used_percent: utilization * 100.0,
        resets_at: info["resetsAt"].as_i64(),
        remaining: None,
        unit: None,
    }]) else {
        return;
    };
    let key = format!("{}:{}:{}", agent.id, agent.executable, agent.version);
    let cache = state.quotas.lock().unwrap().entry(key).or_default().clone();
    let mut cached = cache.lock().unwrap();
    cached.value = Some(data);
    cached.at = Some(Instant::now());
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_quota_is_not_zero_or_session_usage() {
        assert!(codex(&json!({})).is_none());
        assert!(qoder(&json!({"session":{"credits":10}})).is_none());
        assert!(codex(&json!({"rateLimits":{"primary":{"usedPercent":-1}}})).is_none());
        assert_eq!(
            codex(&json!({"rateLimits":{"primary":{"usedPercent":0}}}))
                .unwrap()
                .windows[0]
                .used_percent,
            0.0
        );
    }
    #[test]
    fn multi_bucket_and_expired_windows() {
        let q = codex(&json!({"rateLimitsByLimitId":{"a":{"primary":{"usedPercent":25,"windowDurationMins":300}},"b":{"primary":{"usedPercent":90,"resetsAt":1},"secondary":{"usedPercent":40,"windowDurationMins":10080}}}})).unwrap();
        assert_eq!(q.windows.len(), 2);
        assert_eq!(q.windows[0].label, "5 小时");
        assert_eq!(q.windows[1].label, "每周");
        let q = qoder(&json!({"usage":{"userQuota":{"percentage":35,"remaining":650,"unit":"Credits"},"orgResourcePackage":{"available":false,"percentage":0}}})).unwrap();
        assert_eq!(q.windows.len(), 1);
        assert_eq!(q.windows[0].remaining, Some(650.0));
    }
    #[test]
    fn metadata_handshakes_never_send_prompts_and_time_out() {
        for mode in ["codex", "qoder", "hang"] {
            let mut command = crate::process::background_command(std::env::current_exe().unwrap());
            command
                .args([
                    "--exact",
                    "quotas::tests::metadata_child_probe",
                    "--nocapture",
                ])
                .env("OIAGENT_QUOTA_PROBE_TEST", mode)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            #[cfg(unix)]
            {
                use std::os::unix::process::CommandExt;
                command.process_group(0);
            }
            let timeout = if mode == "hang" {
                Duration::from_millis(100)
            } else {
                Duration::from_secs(5)
            };
            let start = Instant::now();
            let value = exchange(command.spawn().unwrap(), mode != "qoder", timeout);
            if mode == "hang" {
                assert!(value.is_none());
                assert!(start.elapsed() < Duration::from_secs(3));
            } else {
                assert_eq!(value.unwrap().windows[0].used_percent, 35.0);
            }
        }
    }
    #[test]
    fn metadata_child_probe() {
        let Ok(mode) = std::env::var("OIAGENT_QUOTA_PROBE_TEST") else {
            return;
        };
        let mut lines = std::io::stdin().lock().lines();
        let mut next = || serde_json::from_str::<Value>(&lines.next().unwrap().unwrap()).unwrap();
        let init = next();
        if mode == "hang" {
            std::thread::sleep(Duration::from_secs(20));
            return;
        }
        if mode == "codex" {
            assert_eq!(init["method"], "initialize");
            println!("{}", json!({"id":1,"result":{}}));
            std::io::stdout().flush().unwrap();
            assert_eq!(next()["method"], "initialized");
            assert_eq!(next()["method"], "account/rateLimits/read");
            println!(
                "{}",
                json!({"id":2,"result":{"rateLimits":{"primary":{"usedPercent":35}}}})
            );
        } else {
            assert_eq!(init["request"]["type"], "initialize");
            println!(
                "{}",
                json!({"type":"control_response","response":{"request_id":"quota-init","subtype":"success","response":{}}})
            );
            std::io::stdout().flush().unwrap();
            assert_eq!(next()["request"]["type"], "get_usage_info");
            println!(
                "{}",
                json!({"type":"control_response","response":{"request_id":"quota-read","subtype":"success","response":{"usage":{"userQuota":{"percentage":35}}}}})
            );
        }
        std::io::stdout().flush().unwrap();
    }
}
