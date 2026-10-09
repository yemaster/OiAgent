use crate::models::ProviderProfile;
use reqwest::{header, Client, Url};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};

pub fn base_url(raw: &str) -> Result<Url, String> {
    let mut url = Url::parse(raw.trim()).map_err(|_| "API 地址格式无效")?;
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err("API 地址不能包含用户名、密码、查询参数或片段".into());
    }
    if url.scheme() != "https"
        && !(url.scheme() == "http"
            && matches!(
                url.host_str(),
                Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
            ))
    {
        return Err("远程 API 请使用 HTTPS；本机服务可使用 HTTP".into());
    }
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url)
}
pub fn same_service(a: &ProviderProfile, b: &ProviderProfile) -> bool {
    a.auth_type == b.auth_type
        && matches!((base_url(&a.base_url), base_url(&b.base_url)), (Ok(a), Ok(b)) if a == b)
}
fn endpoint(base: &str, resource: &str) -> Result<Url, String> {
    let mut url = base_url(base)?;
    let path = url.path().trim_end_matches('/');
    let path = if path.ends_with("/v1") {
        format!("{path}/{resource}")
    } else {
        format!("{path}/v1/{resource}")
    };
    url.set_path(&path);
    Ok(url)
}
fn client(profile: &ProviderProfile, key: &str) -> Result<Client, String> {
    let mut headers = header::HeaderMap::new();
    headers.insert(
        "anthropic-version",
        header::HeaderValue::from_static("2023-06-01"),
    );
    let (name, value) = match profile.auth_type.as_str() {
        "api-key" => ("x-api-key", key.to_string()),
        "auth-token" => ("authorization", format!("Bearer {key}")),
        _ => return Err("未知鉴权方式".into()),
    };
    if !key.is_empty() {
        let mut value = header::HeaderValue::from_str(&value).map_err(|_| "API Key 格式无效")?;
        value.set_sensitive(true);
        headers.insert(name, value);
    }
    Client::builder()
        .default_headers(headers)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "无法创建 API 连接".into())
}
async fn response_json(
    response: Result<reqwest::Response, reqwest::Error>,
) -> Result<Value, String> {
    let mut response = response.map_err(|e| {
        if e.is_timeout() {
            "连接超时，请检查服务地址或网络"
        } else {
            "无法连接服务，请检查地址、网络或证书"
        }
    })?;
    let status = response.status();
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 | 403 => "鉴权失败，请检查密钥和访问权限",
            404 | 405 => "服务未提供此接口，请检查 Base URL；模型列表不可用时可手动填写",
            429 => "请求受限，请稍后重试或检查服务额度",
            300..=399 => "服务返回重定向，请填写最终 API 地址",
            _ => "请求失败，请检查服务状态和模型配置",
        };
        // Do not echo upstream bodies or URLs: gateways can include credentials in errors.
        return Err(format!("HTTP {}：{hint}", status.as_u16()));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取 API 响应失败")? {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("API 响应过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "服务未返回有效 JSON，请检查 API 地址".into())
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModel {
    pub id: String,
    pub name: String,
}
#[derive(Serialize, Debug)]
pub struct ModelList {
    pub models: Vec<RemoteModel>,
    pub truncated: bool,
}
pub async fn models(profile: ProviderProfile, key: String) -> Result<ModelList, String> {
    tokio::time::timeout(Duration::from_secs(30), load_models(profile, key))
        .await
        .map_err(|_| "获取模型列表超时，请稍后重试".to_string())?
}
async fn load_models(profile: ProviderProfile, key: String) -> Result<ModelList, String> {
    let client = client(&profile, &key)?;
    let mut url = endpoint(&profile.base_url, "models")?;
    let mut found = BTreeMap::new();
    let mut cursors = std::collections::HashSet::new();
    for page in 0..10 {
        let value = response_json(client.get(url.clone()).send().await).await?;
        let rows = value
            .get("data")
            .and_then(Value::as_array)
            .ok_or("模型列表格式不支持，请手动填写模型 ID")?;
        let capacity = 1000usize.saturating_sub(found.len());
        for row in rows.iter().take(capacity) {
            if let Some(id) = row
                .get("id")
                .and_then(Value::as_str)
                .filter(|id| !id.trim().is_empty() && id.len() <= 512)
            {
                found.insert(
                    id.to_string(),
                    row.get("display_name")
                        .and_then(Value::as_str)
                        .unwrap_or(id)
                        .chars()
                        .take(256)
                        .collect(),
                );
            }
        }
        let more = value
            .get("has_more")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let truncated = rows.len() > capacity || (more && (page == 9 || found.len() >= 1000));
        if !more || truncated {
            return Ok(ModelList {
                models: found
                    .into_iter()
                    .map(|(id, name)| RemoteModel { id, name })
                    .collect(),
                truncated,
            });
        }
        let cursor = value
            .get("last_id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("模型列表缺少分页游标")?;
        if !cursors.insert(cursor.to_string()) {
            return Err("模型列表分页游标重复".into());
        }
        url.set_query(None);
        url.query_pairs_mut().append_pair("after_id", cursor);
    }
    unreachable!()
}
pub fn test_model(profile: &ProviderProfile, model: &str) -> Result<String, String> {
    let model = model.trim();
    let mapped = match model {
        "haiku" => profile.haiku_model.trim(),
        "sonnet" => profile.sonnet_model.trim(),
        "opus" => profile.opus_model.trim(),
        "fable" => profile.fable_model.trim(),
        _ => model,
    };
    if mapped.is_empty()
        || ["haiku", "sonnet", "opus", "fable", "opusplan"].contains(&mapped)
        || mapped.ends_with("[1m]")
    {
        return Err("请选择具体的测试模型 ID；使用别名时请先填写对应模型映射".into());
    }
    Ok(mapped.to_string())
}
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTest {
    pub model: String,
    pub latency_ms: u128,
}
pub async fn test(
    profile: ProviderProfile,
    key: String,
    model: String,
) -> Result<ConnectionTest, String> {
    let model = test_model(&profile, &model)?;
    let client = client(&profile, &key)?;
    let start = Instant::now();
    let value = response_json(
        client
            .post(endpoint(&profile.base_url, "messages")?)
            .json(&json!({
                "model": model, "max_tokens": 16, "stream": false,
                "messages": [{ "role": "user", "content": "Reply OK." }]
            }))
            .send()
            .await,
    )
    .await?;
    if value.get("type").and_then(Value::as_str) != Some("message")
        || !value.get("content").is_some_and(Value::is_array)
        || value.get("error").is_some()
    {
        return Err("服务响应不符合 Anthropic Messages 格式".into());
    }
    Ok(ConnectionTest {
        model,
        latency_ms: start.elapsed().as_millis(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    fn profile(base: &str) -> ProviderProfile {
        // Existing stored profiles do not have a Fable field.
        serde_json::from_value(json!({"id":"", "name":"Test", "baseUrl":base, "authType":"api-key", "defaultModel":"", "haikuModel":"", "sonnetModel":"", "opusModel":"", "hasKey":false})).unwrap()
    }
    fn server(
        replies: Vec<(u16, Value)>,
    ) -> (
        String,
        std::thread::JoinHandle<Vec<(String, String, Value)>>,
    ) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let thread = std::thread::spawn(move || {
            let mut requests = vec![];
            for (status, body) in replies {
                let start = Instant::now();
                let mut stream = loop {
                    if let Ok((stream, _)) = listener.accept() {
                        break stream;
                    }
                    assert!(
                        start.elapsed() < Duration::from_secs(5),
                        "Expected request was not sent"
                    );
                    std::thread::sleep(Duration::from_millis(5));
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut path = String::new();
                reader.read_line(&mut path).unwrap();
                let mut headers = String::new();
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).unwrap();
                    if line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap();
                    }
                    headers.push_str(&line.to_lowercase());
                }
                let mut bytes = vec![0; length];
                reader.read_exact(&mut bytes).unwrap();
                requests.push((
                    path,
                    headers,
                    serde_json::from_slice(&bytes).unwrap_or(Value::Null),
                ));
                let body = body.to_string();
                write!(stream, "HTTP/1.1 {status} Status\r\nContent-Type: application/json\r\nContent-Length: {}\r\nLocation: http://127.0.0.1:1/secret\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
            }
            requests
        });
        (format!("http://{address}"), thread)
    }
    #[test]
    fn validates_urls_and_preserves_gateway_prefixes() {
        assert_eq!(
            endpoint("https://example.test/gateway/v1/", "models")
                .unwrap()
                .as_str(),
            "https://example.test/gateway/v1/models"
        );
        assert_eq!(
            endpoint("https://example.test/gateway", "messages")
                .unwrap()
                .path(),
            "/gateway/v1/messages"
        );
        for url in [
            "http://example.test",
            "https://key@example.test",
            "https://example.test?key=secret",
            "https://example.test#secret",
            "file:///tmp/x",
        ] {
            assert!(base_url(url).is_err());
        }
        let p = profile("https://example.test/");
        assert!(same_service(&p, &profile("https://example.test")));
        assert!(!same_service(&p, &profile("https://other.test")));
        assert!(!same_service(&p, &profile("https://example.test/other")));
        assert!(p.fable_model.is_empty());
    }
    #[test]
    fn fetches_authenticated_pages_and_deduplicates_models() {
        let (url, server) = server(vec![
            (
                200,
                json!({"data":[{"id":"a","display_name":"Model A"}],"has_more":true,"last_id":"a"}),
            ),
            (
                200,
                json!({"data":[{"id":"a"},{"id":"b"}],"has_more":false}),
            ),
        ]);
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(models(profile(&format!("{url}/v1")), "test-only".into()))
            .unwrap();
        assert_eq!(
            result
                .models
                .iter()
                .map(|m| m.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b"]
        );
        assert!(!result.truncated);
        let requests = server.join().unwrap();
        assert!(requests[0].0.starts_with("GET /v1/models "));
        assert!(requests[1].0.starts_with("GET /v1/models?after_id=a "));
        assert!(requests.iter().all(|r| r.1.contains("x-api-key: test-only")
            && r.1.contains("anthropic-version: 2023-06-01")
            && !r.1.contains("authorization:")));
    }
    #[test]
    fn tests_messages_with_bearer_auth_and_resolves_fable_mapping() {
        let (url, server) = server(vec![(
            200,
            json!({"type":"message", "content":[{"type":"text", "text":"OK"}]}),
        )]);
        let mut p = profile(&url);
        p.auth_type = "auth-token".into();
        p.fable_model = "gateway-fable".into();
        assert_eq!(test_model(&p, "fable").unwrap(), "gateway-fable");
        assert!(test_model(&p, "sonnet").is_err());
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(test(p, "test-only".into(), "fable".into()))
            .unwrap();
        assert_eq!(result.model, "gateway-fable");
        let requests = server.join().unwrap();
        assert!(requests[0].0.starts_with("POST /v1/messages "));
        assert!(requests[0].1.contains("authorization: bearer test-only"));
        assert!(!requests[0].1.contains("x-api-key:"));
        assert_eq!(requests[0].2["model"], "gateway-fable");
        assert_eq!(requests[0].2["max_tokens"], 16);
        assert!(requests[0].2.get("tools").is_none());
    }
    #[test]
    fn rejects_redirects_and_never_echoes_upstream_error_secrets() {
        for status in [302, 401, 404, 429] {
            let (url, server) = server(vec![(status, json!({"error":"test-only-secret"}))]);
            let error = tokio::runtime::Runtime::new()
                .unwrap()
                .block_on(models(profile(&url), "test-only-secret".into()))
                .unwrap_err();
            assert!(error.contains(&status.to_string()));
            assert!(!error.contains("test-only-secret"));
            server.join().unwrap();
        }
    }
    #[test]
    fn a_success_status_with_an_error_body_is_not_a_successful_test() {
        let (url, server) = server(vec![(200, json!({"error":"bad-key"}))]);
        let error = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(test(profile(&url), "test-only".into(), "model-id".into()))
            .unwrap_err();
        assert!(error.contains("Messages"));
        server.join().unwrap();
    }
}
