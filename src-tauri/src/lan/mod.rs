//! Desktop-to-desktop, opt-in TLS service. This is deliberately not a Tauri RPC proxy.
mod client;
mod rpc;
use crate::{integrations::atomic_write, store::AppState};
use axum::{
    extract::Request,
    extract::{ConnectInfo, DefaultBodyLimit, State as HttpState},
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
pub use client::*;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::{IpAddr, SocketAddr},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, State};

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HostConfig {
    pub name: String,
    pub address: String,
    pub port: u16,
    pub projects: Vec<String>,
    pub agents: Vec<String>,
    pub allow_execution: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub id: String,
    pub name: String,
    pub token_hash: String,
    pub created_at: String,
    pub projects: Vec<String>,
    pub agents: Vec<String>,
    pub allow_execution: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Peer {
    pub id: String,
    pub name: String,
    pub address: String,
    pub certificate: String,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Saved {
    config: HostConfig,
    grants: Vec<Grant>,
    peers: Vec<Peer>,
    owners: HashMap<String, String>,
}
struct Pending {
    id: String,
    name: String,
    ip: String,
    secret_hash: String,
    expires: Instant,
    token: Option<String>,
    grant_id: Option<String>,
    rejected: bool,
}
struct Invitation {
    hash: String,
    expires: Instant,
}
struct Inner {
    saved: Saved,
    handle: Option<axum_server::Handle<SocketAddr>>,
    invitation: Option<Invitation>,
    pending: Vec<Pending>,
    certificate: String,
    error: String,
    generation: u64,
    rates: HashMap<IpAddr, (Instant, u32)>,
}
pub struct LanState {
    inner: Mutex<Inner>,
    dir: PathBuf,
    connections: tokio::sync::Semaphore,
}
#[derive(Clone)]
struct HttpContext {
    app: tauri::AppHandle,
    lan: Arc<LanState>,
    generation: u64,
}
impl LanState {
    pub fn load(dir: PathBuf) -> Result<Self, String> {
        let file = dir.join("lan.json");
        let saved = if file.exists() {
            serde_json::from_slice(&std::fs::read(file).map_err(|e| e.to_string())?)
                .map_err(|e| format!("局域网配置无法读取：{e}"))?
        } else {
            Saved::default()
        };
        Ok(Self {
            inner: Mutex::new(Inner {
                saved,
                handle: None,
                invitation: None,
                pending: vec![],
                certificate: String::new(),
                error: String::new(),
                generation: 0,
                rates: HashMap::new(),
            }),
            dir,
            connections: tokio::sync::Semaphore::new(16),
        })
    }
    fn save(&self, inner: &Inner) -> Result<(), String> {
        atomic_write(
            &self.dir.join("lan.json"),
            &serde_json::to_vec_pretty(&inner.saved).map_err(|e| e.to_string())?,
        )
    }
}
fn secret() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}
fn digest(s: &str) -> String {
    format!("{:x}", Sha256::digest(s.as_bytes()))
}
fn same_hash(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0u8, |diff, (x, y)| diff | (x ^ y))
            == 0
}
pub fn private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private(),
        IpAddr::V6(ip) => ip.is_unique_local(),
    }
}
fn interfaces() -> Vec<Value> {
    if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter(|i| private_ip(i.ip()))
        .map(|i| json!({"name":i.name,"address":i.ip().to_string()}))
        .collect()
}
fn check_config(app: &tauri::AppHandle, c: &mut HostConfig) -> Result<(), String> {
    c.name = c.name.trim().to_string();
    if c.name.is_empty() || c.name.chars().count() > 80 {
        return Err("设备名称需要 1–80 个字符".into());
    }
    let ip: IpAddr = c.address.parse().map_err(|_| "请选择本机局域网地址")?;
    if !private_ip(ip) || !interfaces().iter().any(|i| i["address"] == c.address) || c.port < 1024 {
        return Err("只允许本机私有网卡地址和 1024–65535 端口".into());
    }
    if c.projects.is_empty() || c.projects.len() > 50 || c.agents.is_empty() {
        return Err("至少选择一个项目和 Agent（最多 50 个项目）".into());
    }
    for p in &mut c.projects {
        *p = canonical_project(p)?;
    }
    let state = app.state::<AppState>();
    let db = state.db.lock().unwrap();
    for id in &c.agents {
        let a = db
            .agents
            .iter()
            .find(|a| a.id == *id && a.available && !a.custom)
            .ok_or("只能共享已安装的内置 Agent")?;
        if !rpc::supported(&a.kind) || !a.args.is_empty() {
            return Err("此 Agent 不支持局域网执行".into());
        }
    }
    Ok(())
}
fn canonical_project(p: &str) -> Result<String, String> {
    let path = std::fs::canonicalize(p).map_err(|_| "共享项目目录不存在")?;
    if !path.is_dir() {
        return Err("项目必须是目录".into());
    }
    Ok(path.to_string_lossy().into())
}
fn public_status(lan: &LanState) -> Value {
    let mut i = lan.inner.lock().unwrap();
    i.pending.retain(|p| p.expires > Instant::now());
    json!({"enabled":i.handle.is_some(),"config":i.saved.config,"interfaces":interfaces(),"error":i.error,"peers":i.saved.peers.iter().map(|p|json!({"id":p.id,"name":p.name,"address":p.address})).collect::<Vec<_>>(),"grants":i.saved.grants.iter().map(|g|json!({"id":g.id,"name":g.name,"createdAt":g.created_at,"allowExecution":g.allow_execution,"projects":g.projects})).collect::<Vec<_>>(),"pending":i.pending.iter().filter(|p|p.token.is_none()&&!p.rejected).map(|p|json!({"id":p.id,"name":p.name,"ip":p.ip})).collect::<Vec<_>>()})
}
#[tauri::command]
pub fn lan_status(lan: State<Arc<LanState>>) -> Value {
    public_status(&lan)
}
#[tauri::command]
pub async fn lan_enable(app: tauri::AppHandle, mut config: HostConfig) -> Result<Value, String> {
    check_config(&app, &mut config)?;
    let lan = app.state::<Arc<LanState>>().inner().clone();
    if lan.inner.lock().unwrap().handle.is_some() {
        return Err("请先关闭共享再修改配置".into());
    }
    let _ = rustls::crypto::ring::default_provider().install_default();
    let cert_file = lan.dir.join("lan-identity.json");
    let identity: Value = if cert_file.exists() {
        serde_json::from_slice(&std::fs::read(&cert_file).map_err(|e| e.to_string())?)
            .map_err(|e| format!("证书文件损坏：{e}"))?
    } else {
        Value::Null
    };
    let (certificate, key) = if identity["address"] == config.address {
        (
            identity["certificate"]
                .as_str()
                .ok_or("缺少证书")?
                .to_string(),
            identity["key"].as_str().ok_or("缺少私钥")?.to_string(),
        )
    } else {
        let certified = rcgen::generate_simple_self_signed(vec![config.address.clone()])
            .map_err(|e| e.to_string())?;
        let (certificate, key) = (certified.cert.pem(), certified.signing_key.serialize_pem());
        atomic_write(
            &cert_file,
            &serde_json::to_vec(
                &json!({"address":config.address,"certificate":certificate,"key":key}),
            )
            .unwrap(),
        )?;
        (certificate, key)
    };
    let tls = axum_server::tls_rustls::RustlsConfig::from_pem(
        certificate.as_bytes().to_vec(),
        key.as_bytes().to_vec(),
    )
    .await
    .map_err(|e| e.to_string())?;
    let address = SocketAddr::new(config.address.parse().unwrap(), config.port);
    let listener =
        std::net::TcpListener::bind(address).map_err(|e| format!("无法监听 {address}：{e}"))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let handle = axum_server::Handle::new();
    let generation = {
        let mut i = lan.inner.lock().unwrap();
        if i.handle.is_some() {
            return Err("共享已开启".into());
        }
        i.saved.config = config;
        lan.save(&i)?;
        i.certificate = certificate;
        i.generation += 1;
        i.handle = Some(handle.clone());
        i.error.clear();
        i.generation
    };
    let context = HttpContext {
        app,
        lan: lan.clone(),
        generation,
    };
    let router = Router::new()
        .route("/v1", post(endpoint))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .layer(middleware::from_fn_with_state(context.clone(), guard))
        .with_state(context);
    let running = lan.clone();
    tauri::async_runtime::spawn(async move {
        let result = axum_server::from_tcp_rustls(listener, tls)
            .unwrap()
            .handle(handle)
            .serve(router.into_make_service_with_connect_info::<SocketAddr>())
            .await;
        let mut i = running.inner.lock().unwrap();
        if i.generation == generation {
            i.handle = None;
            if let Err(e) = result {
                i.error = e.to_string();
            }
        }
    });
    Ok(public_status(&lan))
}
#[tauri::command]
pub fn lan_disable(lan: State<Arc<LanState>>) -> Value {
    let mut i = lan.inner.lock().unwrap();
    i.generation += 1;
    if let Some(h) = i.handle.take() {
        h.shutdown();
    }
    i.invitation = None;
    i.pending.clear();
    drop(i);
    public_status(&lan)
}
#[tauri::command]
pub fn lan_invite(lan: State<Arc<LanState>>) -> Result<String, String> {
    let mut i = lan.inner.lock().unwrap();
    if i.handle.is_none() {
        return Err("请先开启本机共享".into());
    }
    let code = secret();
    i.invitation = Some(Invitation {
        hash: digest(&code),
        expires: Instant::now() + Duration::from_secs(300),
    });
    let ip: IpAddr = i.saved.config.address.parse().map_err(|_| "地址无效")?;
    let invitation = json!({"version":1,"address":format!("https://{}",SocketAddr::new(ip,i.saved.config.port)),"certificate":i.certificate,"code":code,"name":i.saved.config.name});
    Ok(format!(
        "oiagent:v1:{}",
        URL_SAFE_NO_PAD.encode(serde_json::to_vec(&invitation).unwrap())
    ))
}
#[tauri::command]
pub fn lan_approve(lan: State<Arc<LanState>>, id: String, approve: bool) -> Result<(), String> {
    let mut i = lan.inner.lock().unwrap();
    let index = i
        .pending
        .iter()
        .position(|p| p.id == id && p.expires > Instant::now() && p.token.is_none() && !p.rejected)
        .ok_or("配对请求已过期")?;
    if !approve {
        i.pending[index].rejected = true;
        return Ok(());
    }
    if i.saved.grants.len() >= 20 {
        return Err("最多配对 20 台设备，请先撤销旧设备".into());
    }
    let token = secret();
    let grant_id = uuid::Uuid::new_v4().to_string();
    let c = &i.saved.config;
    let grant = Grant {
        id: grant_id.clone(),
        name: i.pending[index].name.clone(),
        token_hash: digest(&token),
        created_at: crate::models::now(),
        projects: c.projects.clone(),
        agents: c.agents.clone(),
        allow_execution: c.allow_execution,
    };
    i.saved.grants.push(grant);
    if let Err(e) = lan.save(&i) {
        i.saved.grants.pop();
        return Err(e);
    }
    i.pending[index].token = Some(token);
    i.pending[index].grant_id = Some(grant_id);
    Ok(())
}
#[tauri::command]
pub fn lan_revoke(lan: State<Arc<LanState>>, id: String) -> Result<(), String> {
    let mut i = lan.inner.lock().unwrap();
    i.saved.grants.retain(|g| g.id != id);
    i.pending.retain(|p| p.grant_id.as_deref() != Some(&id));
    lan.save(&i)
}
async fn guard(
    HttpState(context): HttpState<HttpContext>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    request: Request,
    next: Next,
) -> Response {
    let fail = |status, message: &str| (status, Json(json!({"error":message}))).into_response();
    if !private_ip(remote.ip()) {
        return fail(StatusCode::FORBIDDEN, "只允许局域网设备连接");
    }
    if request.headers().contains_key("origin") {
        return fail(StatusCode::FORBIDDEN, "仅允许 OiAgent 桌面客户端");
    }
    let _permit = match context.lan.connections.try_acquire() {
        Ok(permit) => permit,
        Err(_) => return fail(StatusCode::TOO_MANY_REQUESTS, "请求过多"),
    };
    {
        let mut i = context.lan.inner.lock().unwrap();
        if i.generation != context.generation || i.handle.is_none() {
            return fail(StatusCode::FORBIDDEN, "共享已关闭");
        }
        i.rates
            .retain(|_, (start, _)| start.elapsed() < Duration::from_secs(60));
        if !i.rates.contains_key(&remote.ip()) && i.rates.len() >= 128 {
            return fail(StatusCode::TOO_MANY_REQUESTS, "请求过多");
        }
        let rate = i.rates.entry(remote.ip()).or_insert((Instant::now(), 0));
        rate.1 += 1;
        if rate.1 > 120 {
            return fail(StatusCode::TOO_MANY_REQUESTS, "请求过多，请稍后再试");
        }
    }
    match tokio::time::timeout(Duration::from_secs(15), next.run(request)).await {
        Ok(response) => response,
        Err(_) => fail(StatusCode::REQUEST_TIMEOUT, "请求超时"),
    }
}
async fn endpoint(
    HttpState(context): HttpState<HttpContext>,
    ConnectInfo(remote): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let fail = |status, message: &str| (status, Json(json!({"error":message})));
    let app = context.app.clone();
    let lan = context.lan.clone();
    let generation = context.generation;
    let authorization = headers
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .strip_prefix("Bearer ")
        .unwrap_or("")
        .to_owned();
    let result = tauri::async_runtime::spawn_blocking(move || {
        dispatch_request(&app, &lan, generation, &authorization, remote.ip(), &body)
    })
    .await
    .map_err(|_| fail(StatusCode::INTERNAL_SERVER_ERROR, "请求处理失败"))?;
    result
        .map(Json)
        .map_err(|e: String| fail(StatusCode::BAD_REQUEST, &e))
}
fn dispatch_request<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    lan: &LanState,
    generation: u64,
    authorization: &str,
    remote: IpAddr,
    body: &Value,
) -> Result<Value, String> {
    let mut i = lan.inner.lock().unwrap();
    if i.generation != generation || i.handle.is_none() {
        return Err("共享已关闭".into());
    }
    let command = body["command"].as_str().ok_or("缺少操作")?;
    let args = &body["args"];
    match command {
        "pair_request" => {
            let code = args["code"].as_str().ok_or("缺少配对码")?;
            let valid = i.invitation.as_ref().is_some_and(|invite| {
                invite.expires > Instant::now() && same_hash(&invite.hash, &digest(code))
            });
            if !valid {
                return Err("配对码无效或已过期".into());
            }
            let name = args["name"]
                .as_str()
                .filter(|s| !s.trim().is_empty() && s.chars().count() <= 80)
                .ok_or("设备名称无效")?;
            i.pending.retain(|p| p.expires > Instant::now());
            if i.pending.len() >= 16 {
                return Err("待审批请求过多".into());
            }
            let ticket = secret();
            let id = uuid::Uuid::new_v4().to_string();
            i.pending.push(Pending {
                id: id.clone(),
                name: name.into(),
                ip: remote.to_string(),
                secret_hash: digest(&ticket),
                expires: Instant::now() + Duration::from_secs(300),
                token: None,
                grant_id: None,
                rejected: false,
            });
            i.invitation = None;
            Ok(json!({"id":id,"ticket":ticket}))
        }
        "pair_poll" => {
            let p = i
                .pending
                .iter_mut()
                .find(|p| {
                    Some(p.id.as_str()) == args["id"].as_str()
                        && p.expires > Instant::now()
                        && same_hash(
                            &p.secret_hash,
                            &digest(args["ticket"].as_str().unwrap_or("")),
                        )
                })
                .ok_or("配对请求已过期")?;
            if p.rejected {
                return Err("本机已拒绝配对".into());
            }
            if let Some(token) = &p.token {
                Ok(json!({"approved":true,"token":token}))
            } else {
                Ok(json!({"approved":false}))
            }
        }
        _ => {
            let hash = digest(&authorization);
            let grant = i
                .saved
                .grants
                .iter()
                .find(|g| same_hash(&g.token_hash, &hash))
                .cloned()
                .ok_or("设备未授权或授权已撤销")?;
            // Authorization and side effects share this lock: revocation cannot race a queued write.
            rpc::dispatch(app, lan, &mut i, &grant, command, args)
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_private_interfaces() {
        for ip in ["127.0.0.1", "0.0.0.0", "8.8.8.8", "::1", "169.254.0.1"] {
            assert!(!private_ip(ip.parse().unwrap()));
        }
        for ip in ["192.168.1.2", "10.1.2.3", "172.16.1.1", "fd00::1"] {
            assert!(private_ip(ip.parse().unwrap()));
        }
    }
    #[test]
    fn tokens_are_random_and_compared_without_prefix_acceptance() {
        let a = secret();
        let b = secret();
        assert_ne!(a, b);
        assert!(same_hash(&digest(&a), &digest(&a)));
        assert!(!same_hash(&digest(&a), &digest(&b)));
        assert!(!same_hash("abc", "ab"));
    }
    #[test]
    fn pairing_requires_approval_scopes_tasks_and_revocation_is_immediate() {
        use tauri::test::{mock_builder, mock_context, noop_assets};
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let app = mock_builder().build(mock_context(noop_assets())).unwrap();
        let state = AppState::load(root.join("app")).unwrap();
        state.db.lock().unwrap().agents.push(crate::models::Agent {
            id: "codex".into(),
            kind: "codex".into(),
            name: "Codex".into(),
            executable: "not-executed".into(),
            args: vec![],
            available: true,
            custom: false,
            version: "".into(),
        });
        app.manage(state);
        let lan = Arc::new(LanState::load(root.join("app")).unwrap());
        app.manage(lan.clone());
        let code = secret();
        {
            let mut i = lan.inner.lock().unwrap();
            i.handle = Some(axum_server::Handle::new());
            i.generation = 1;
            i.saved.config = HostConfig {
                name: "Test".into(),
                address: "192.168.1.1".into(),
                port: 43120,
                projects: vec![root.to_string_lossy().into()],
                agents: vec!["codex".into()],
                allow_execution: true,
            };
            i.invitation = Some(Invitation {
                hash: digest(&code),
                expires: Instant::now() + Duration::from_secs(300),
            });
        }
        let request = |token: &str, command: &str, args: Value| {
            dispatch_request(
                app.handle(),
                &lan,
                1,
                token,
                "192.168.1.2".parse().unwrap(),
                &json!({"command":command,"args":args}),
            )
        };
        assert!(request("", "get_snapshot", json!({})).is_err());
        assert!(request("", "pair_request", json!({"code":"wrong","name":"Device"})).is_err());
        let pair = request("", "pair_request", json!({"code":code,"name":"Device"})).unwrap();
        assert!(request("", "pair_request", json!({"code":code,"name":"Replay"})).is_err());
        let poll = json!({"id":pair["id"],"ticket":pair["ticket"]});
        assert_eq!(
            request("", "pair_poll", poll.clone()).unwrap()["approved"],
            false
        );
        assert!(request("", "pair_poll", json!({"id":pair["id"],"ticket":"wrong"})).is_err());
        lan_approve(app.state(), pair["id"].as_str().unwrap().into(), true).unwrap();
        let approved = request("", "pair_poll", poll).unwrap();
        let token = approved["token"].as_str().unwrap();
        assert!(request(token, "terminal_start", json!({"command":"danger"})).is_err());
        assert!(request(token, "get_detail", json!({"id":"../../outside"})).is_err());
        let input = json!({"title":"Queued test","prompt":"no process will run","project":root,"agentId":"codex","model":"","permission":"read-only","queued":true,"resumeSession":null});
        let task = request(token, "create_task", json!({"input":input})).unwrap();
        assert_eq!(task["status"], "queued");
        let snapshot = request(token, "get_snapshot", json!({})).unwrap();
        assert_eq!(snapshot["tasks"].as_array().unwrap().len(), 1);
        let saved = std::fs::read_to_string(root.join("app/lan.json")).unwrap();
        assert!(!saved.contains(token));
        assert!(saved.contains(&digest(token)));
        let grant_id = lan.inner.lock().unwrap().saved.grants[0].id.clone();
        lan_revoke(app.state(), grant_id).unwrap();
        assert!(request(token, "get_snapshot", json!({})).is_err());
        lan_disable(app.state());
        assert!(request("", "pair_request", json!({"code":code,"name":"Device"})).is_err());
        assert_eq!(
            app.state::<AppState>().db.lock().unwrap().tasks[0].status,
            "queued"
        );
    }
}
