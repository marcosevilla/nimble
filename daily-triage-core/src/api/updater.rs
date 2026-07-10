use serde::Deserialize;

use crate::types::UpdateStatus;

#[derive(Debug, Deserialize)]
struct VersionInfo {
    version: String,
    url: Option<String>,
}

pub async fn check_for_updates(current_version: &str) -> UpdateStatus {
    let client = reqwest::Client::new();
    match client
        .get("https://raw.githubusercontent.com/marcosevilla/todo/main/version.json")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
    {
        Ok(resp) => match resp.json::<VersionInfo>().await {
            Ok(info) => {
                let update_available = info.version != current_version;
                UpdateStatus {
                    current_version: current_version.to_string(),
                    latest_version: Some(info.version),
                    update_available,
                    release_url: info.url,
                    error: None,
                }
            }
            Err(_) => UpdateStatus {
                current_version: current_version.to_string(),
                latest_version: None,
                update_available: false,
                release_url: None,
                error: Some("Could not parse version info".to_string()),
            },
        },
        Err(_) => UpdateStatus {
            current_version: current_version.to_string(),
            latest_version: None,
            update_available: false,
            release_url: None,
            error: Some("Could not check for updates — are you online?".to_string()),
        },
    }
}
