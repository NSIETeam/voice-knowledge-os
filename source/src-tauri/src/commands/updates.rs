use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheck {
    pub current_version: String,
    pub latest_version: Option<String>,
    pub update_available: bool,
    pub configured: bool,
}

fn parse_release_version(tag: &str) -> Result<semver::Version, String> {
    let normalized = tag.trim().strip_prefix('v').unwrap_or(tag.trim());
    semver::Version::parse(normalized).map_err(|e| format!("invalid release tag: {e}"))
}

#[tauri::command]
pub async fn updates_check() -> Result<UpdateCheck, String> {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let Some(latest_release_api) = option_env!("HONEYVOICE_RELEASES_API") else {
        return Ok(UpdateCheck {
            current_version,
            latest_version: None,
            update_available: false,
            configured: false,
        });
    };
    if !latest_release_api.starts_with("https://") {
        return Err("HoneyVoice release channel must use HTTPS".into());
    }
    let response = reqwest::Client::builder()
        .user_agent(format!("HoneyVoice/{current_version}"))
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| format!("create update checker: {e}"))?
        .get(latest_release_api)
        .header(reqwest::header::ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("check GitHub releases: {e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub releases returned an error: {e}"))?;
    let release: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("read GitHub release: {e}"))?;
    let tag_name = release
        .get("tag_name")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "release response is missing tag_name".to_string())?;
    let current = parse_release_version(&current_version)?;
    let latest = parse_release_version(tag_name)?;

    Ok(UpdateCheck {
        current_version,
        latest_version: Some(latest.to_string()),
        update_available: latest > current,
        configured: true,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_release_version;

    #[test]
    fn parses_release_tags_with_or_without_v_prefix() {
        assert_eq!(
            parse_release_version("v1.2.3").unwrap().to_string(),
            "1.2.3"
        );
        assert_eq!(parse_release_version("1.2.3").unwrap().to_string(), "1.2.3");
    }

    #[test]
    fn rejects_non_semver_release_tags() {
        assert!(parse_release_version("latest").is_err());
    }

    #[tokio::test]
    async fn reports_unconfigured_without_contacting_an_unrelated_repository() {
        if option_env!("HONEYVOICE_RELEASES_API").is_some() {
            return;
        }
        let check = super::updates_check().await.unwrap();
        assert!(!check.configured);
        assert!(!check.update_available);
        assert_eq!(check.latest_version, None);
    }
}
