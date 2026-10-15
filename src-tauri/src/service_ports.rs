//! Optional reachability checks for local endpoints reported in task output.
use serde::Serialize;
use std::{
    collections::BTreeSet,
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    time::Duration,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortStatus {
    port: u16,
    reachable: bool,
}

#[tauri::command]
pub async fn probe_service_ports(ports: Vec<u16>) -> Result<Vec<PortStatus>, String> {
    if ports.len() > 16 || ports.contains(&0) {
        return Err("一次最多检测 16 个有效端口".into());
    }
    let mut pending = tokio::task::JoinSet::new();
    for port in ports.into_iter().collect::<BTreeSet<_>>() {
        pending.spawn(async move {
            let mut reachable = false;
            for ip in [
                IpAddr::V4(Ipv4Addr::LOCALHOST),
                IpAddr::V6(Ipv6Addr::LOCALHOST),
            ] {
                if matches!(
                    tokio::time::timeout(
                        Duration::from_millis(350),
                        tokio::net::TcpStream::connect(SocketAddr::new(ip, port))
                    )
                    .await,
                    Ok(Ok(_))
                ) {
                    reachable = true;
                    break;
                }
            }
            PortStatus { port, reachable }
        });
    }
    let mut results = Vec::new();
    while let Some(result) = pending.join_next().await {
        results.push(result.map_err(|e| e.to_string())?);
    }
    results.sort_by_key(|result| result.port);
    Ok(results)
}

#[cfg(test)]
mod tests {
    #[test]
    fn detects_only_loopback_reachability_and_rejects_invalid_batches() {
        tauri::async_runtime::block_on(async {
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let port = listener.local_addr().unwrap().port();
            let status = super::probe_service_ports(vec![port, port]).await.unwrap();
            assert_eq!(status.len(), 1);
            assert!(status[0].reachable);
            assert!(super::probe_service_ports(vec![0]).await.is_err());
            assert!(super::probe_service_ports(vec![1; 17]).await.is_err());
        });
    }
}
