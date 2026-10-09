use super::*;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Invite {
    version: u32,
    address: String,
    certificate: String,
    code: String,
    name: String,
}
fn validate_address(address: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(address).map_err(|_| "配对地址无效")?;
    let ip: IpAddr = url
        .host_str()
        .unwrap_or("")
        .trim_matches(['[', ']'])
        .parse()
        .map_err(|_| "只允许局域网 IP 地址")?;
    if url.scheme() != "https"
        || !private_ip(ip)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
        || url.port_or_known_default().unwrap_or(0) < 1024
    {
        return Err("只允许私有局域网的 HTTPS 地址".into());
    }
    Ok(url)
}
fn client(certificate: &str) -> Result<reqwest::blocking::Client, String> {
    let cert =
        reqwest::Certificate::from_pem(certificate.as_bytes()).map_err(|_| "配对证书无效")?;
    reqwest::blocking::Client::builder()
        .tls_built_in_root_certs(false)
        .add_root_certificate(cert)
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())
}
fn request(peer: &Peer, token: Option<&str>, command: &str, args: Value) -> Result<Value, String> {
    let url = validate_address(&peer.address)?
        .join("v1")
        .map_err(|e| e.to_string())?;
    let mut req = client(&peer.certificate)?
        .post(url)
        .json(&json!({"command":command,"args":args}));
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let response = req
        .send()
        .map_err(|_| "无法安全连接设备，请确认对方已开启共享、网络地址和配对证书未变")?;
    let status = response.status();
    let mut bytes = vec![];
    use std::io::Read;
    response
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("远程响应过大".into());
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "设备返回无效数据")?;
    if !status.is_success() {
        return Err(value["error"].as_str().unwrap_or("远程请求被拒绝").into());
    }
    Ok(value)
}
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn save_token(id: &str, token: &str) -> Result<(), String> {
    keyring::Entry::new("com.oiagent.desktop.lan", id)
        .map_err(|e| e.to_string())?
        .set_password(token)
        .map_err(|e| e.to_string())
}
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn read_token(id: &str) -> Result<String, String> {
    keyring::Entry::new("com.oiagent.desktop.lan", id)
        .map_err(|e| e.to_string())?
        .get_password()
        .map_err(|_| "设备凭据不可用，请重新配对".into())
}
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
fn delete_token(id: &str) {
    if let Ok(entry) = keyring::Entry::new("com.oiagent.desktop.lan", id) {
        let _ = entry.delete_credential();
    }
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn save_token(_: &str, _: &str) -> Result<(), String> {
    Err("此平台尚未接入安全凭据存储，暂不支持作为控制端配对".into())
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn read_token(_: &str) -> Result<String, String> {
    Err("此平台尚未接入安全凭据存储".into())
}
#[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
fn delete_token(_: &str) {}
fn parse_invite(text: &str) -> Result<Invite, String> {
    if text.len() > 16 * 1024 {
        return Err("配对码过长".into());
    }
    let bytes = URL_SAFE_NO_PAD
        .decode(
            text.trim()
                .strip_prefix("oiagent:v1:")
                .ok_or("请粘贴完整 OiAgent 配对码")?,
        )
        .map_err(|_| "配对码无效")?;
    let invite: Invite = serde_json::from_slice(&bytes).map_err(|_| "配对码格式无效")?;
    validate_address(&invite.address)?;
    if invite.version != 1 || invite.code.len() != 64 || invite.name.chars().count() > 80 {
        return Err("配对码版本或内容无效".into());
    }
    Ok(invite)
}
#[tauri::command]
pub async fn lan_pair_begin(invitation: String, name: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let i = parse_invite(&invitation)?;
        let peer = Peer {
            id: String::new(),
            name: i.name.clone(),
            address: i.address.clone(),
            certificate: i.certificate.clone(),
        };
        let result = request(
            &peer,
            None,
            "pair_request",
            json!({"code":i.code,"name":name}),
        )?;
        Ok(json!({"invite":i,"id":result["id"],"ticket":result["ticket"]}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn lan_pair_finish(
    app: tauri::AppHandle,
    invite: Invite,
    id: String,
    ticket: String,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut peer = Peer {
            id: String::new(),
            name: invite.name,
            address: invite.address,
            certificate: invite.certificate,
        };
        let result = request(&peer, None, "pair_poll", json!({"id":id,"ticket":ticket}))?;
        if result["approved"] != true {
            return Ok(json!({"approved":false}));
        }
        let token = result["token"].as_str().ok_or("设备未返回凭据")?;
        let lan = app.state::<Arc<LanState>>();
        let mut inner = lan.inner.lock().unwrap();
        if inner.saved.peers.len() >= 20 {
            return Err("最多连接 20 台设备".into());
        }
        if inner.saved.peers.iter().any(|p| p.address == peer.address) {
            return Err("该地址已连接，请先移除旧连接再配对".into());
        }
        peer.id = uuid::Uuid::new_v4().to_string();
        save_token(&peer.id, token)?;
        inner.saved.peers.push(peer.clone());
        if let Err(e) = lan.save(&inner) {
            inner.saved.peers.pop();
            delete_token(&peer.id);
            return Err(e);
        }
        Ok(json!({"approved":true,"deviceId":peer.id}))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn lan_forget(lan: State<Arc<LanState>>, id: String) -> Result<(), String> {
    let mut inner = lan.inner.lock().unwrap();
    let old = inner.saved.peers.clone();
    inner.saved.peers.retain(|p| p.id != id);
    if let Err(e) = lan.save(&inner) {
        inner.saved.peers = old;
        return Err(e);
    }
    delete_token(&id);
    Ok(())
}
#[tauri::command]
pub async fn lan_rpc(
    app: tauri::AppHandle,
    peer_id: String,
    command: String,
    args: Value,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let lan = app.state::<Arc<LanState>>();
        let peer = lan
            .inner
            .lock()
            .unwrap()
            .saved
            .peers
            .iter()
            .find(|p| p.id == peer_id)
            .cloned()
            .ok_or("设备已移除")?;
        let token = read_token(&peer.id)?;
        request(&peer, Some(&token), &command, args)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn lan_remote_snapshots(app: tauri::AppHandle) -> Result<Vec<Value>, String> {
    let peers = app
        .state::<Arc<LanState>>()
        .inner
        .lock()
        .unwrap()
        .saved
        .peers
        .clone();
    let jobs:Vec<_>=peers.into_iter().map(|peer|tauri::async_runtime::spawn_blocking(move||{match read_token(&peer.id).and_then(|token|request(&peer,Some(&token),"get_snapshot",json!({}))){Ok(snapshot)=>json!({"id":peer.id,"name":peer.name,"address":peer.address,"online":true,"snapshot":snapshot}),Err(error)=>json!({"id":peer.id,"name":peer.name,"address":peer.address,"online":false,"error":error})}})).collect();
    let mut result = vec![];
    for job in jobs {
        result.push(job.await.map_err(|e| e.to_string())?);
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reject_untrusted_destinations() {
        for url in [
            "http://192.168.1.2:4000",
            "https://example.com:4000",
            "https://127.0.0.1:4000",
            "https://192.168.1.1:4000/path",
            "https://u:p@192.168.1.1:4000",
            "https://192.168.1.1:4000?x=1",
            "https://192.168.1.1",
        ] {
            assert!(validate_address(url).is_err(), "{url}");
        }
        assert!(validate_address("https://192.168.1.2:43120").is_ok());
        assert!(validate_address("https://[fd00::1]:43120").is_ok());
    }
    #[test]
    fn tls_accepts_only_the_paired_certificate() {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (address, certificate, handle) = runtime.block_on(async {
            let identity = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
            let certificate = identity.cert.pem();
            let tls = axum_server::tls_rustls::RustlsConfig::from_pem(
                certificate.as_bytes().to_vec(),
                identity.signing_key.serialize_pem().into_bytes(),
            )
            .await
            .unwrap();
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let address = listener.local_addr().unwrap();
            let handle = axum_server::Handle::new();
            let running = handle.clone();
            tokio::spawn(async move {
                axum_server::from_tcp_rustls(listener, tls)
                    .unwrap()
                    .handle(running)
                    .serve(
                        axum::Router::new()
                            .route("/", axum::routing::get(|| async { "paired" }))
                            .into_make_service(),
                    )
                    .await
                    .unwrap();
            });
            (address, certificate, handle)
        });
        let url = format!("https://{address}");
        assert_eq!(
            client(&certificate)
                .unwrap()
                .get(&url)
                .send()
                .unwrap()
                .text()
                .unwrap(),
            "paired"
        );
        let other = rcgen::generate_simple_self_signed(vec!["127.0.0.1".into()]).unwrap();
        assert!(client(&other.cert.pem()).unwrap().get(&url).send().is_err());
        handle.shutdown();
    }
}
