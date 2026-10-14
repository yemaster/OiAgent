use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    html_url: String,
    draft: bool,
    prerelease: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    current_version: String,
    latest_version: String,
    release_url: String,
    update_available: bool,
}

fn release_info(current: &str, release: Release) -> Result<UpdateInfo, String> {
    let tag = release.tag_name.trim();
    let latest = semver::Version::parse(tag.strip_prefix('v').unwrap_or(tag))
        .map_err(|_| "无法识别发布版本")?;
    let installed = semver::Version::parse(current).map_err(|_| "无法读取当前版本")?;
    if release.draft || release.prerelease || !latest.pre.is_empty() {
        return Err("暂无正式版本".into());
    }
    let url = reqwest::Url::parse(&release.html_url).map_err(|_| "无效的版本链接")?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || !url.path().starts_with("/yemaster/OiAgent/releases/tag/")
    {
        return Err("无效的版本链接".into());
    }
    Ok(UpdateInfo {
        current_version: current.into(),
        latest_version: latest.to_string(),
        release_url: url.to_string(),
        update_available: latest.cmp_precedence(&installed).is_gt(),
    })
}

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!("OiAgent/{}", app.package_info().version))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "无法检查更新")?;
    let response = client
        .get("https://api.github.com/repos/yemaster/OiAgent/releases/latest")
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|_| "检查失败，请检查网络后重试")?;
    match response.status().as_u16() {
        200 => {}
        404 => return Err("暂无已发布版本".into()),
        403 | 429 => return Err("检查过于频繁，请稍后重试".into()),
        _ => return Err("检查失败，请稍后重试".into()),
    }
    let release = response
        .json::<Release>()
        .await
        .map_err(|_| "无法读取版本信息")?;
    release_info(&app.package_info().version.to_string(), release)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str) -> Release {
        Release {
            tag_name: tag.into(),
            html_url: format!("https://github.com/yemaster/OiAgent/releases/tag/{tag}"),
            draft: false,
            prerelease: false,
        }
    }
    #[test]
    fn compares_version_precedence_not_strings_or_build_metadata() {
        for (current, latest, available) in [
            ("0.9.0", "v0.10.0", true),
            ("1.0.0", "v1.0.0", false),
            ("2.0.0", "v1.0.0", false),
            ("1.0.0-rc.1", "v1.0.0", true),
            ("1.0.0+abc", "1.0.0+xyz", false),
        ] {
            assert_eq!(
                release_info(current, release(latest))
                    .unwrap()
                    .update_available,
                available
            );
        }
    }
    #[test]
    fn rejects_unpublished_versions_and_untrusted_destinations() {
        assert!(release_info("1.0.0", release("v2.0.0-beta.1")).is_err());
        assert!(release_info("1.0.0", release("not-a-version")).is_err());
        let mut value = release("v2.0.0");
        value.draft = true;
        assert!(release_info("1.0.0", value).is_err());
        let mut value = release("v2.0.0");
        value.html_url = "https://example.com/update".into();
        assert!(release_info("1.0.0", value).is_err());
    }
}
