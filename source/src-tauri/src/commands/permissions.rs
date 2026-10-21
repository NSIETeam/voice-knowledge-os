//! Query through the same child process used for recording. TCC attributes this
//! child to the responsible app; unequal host/helper code hashes do NOT prove
//! unequal permission grants. An old grant can instead name a previous build
//! of the responsible app (confirmed in tccd's code-requirement mismatch logs).

use std::process::Stdio;
use tauri::AppHandle;

#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct PermissionsStatus {
    pub microphone: String,
    pub screen: String,
    /// The responsible app's signature, not the child executable's signature.
    pub ad_hoc_signature: bool,
    /// Makes duplicate installed copies distinguishable in the permission UI.
    pub app_path: String,
}

#[cfg(target_os = "macos")]
fn macos_is_ad_hoc_signed(executable: &std::path::Path) -> bool {
    static IS_AD_HOC: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    // A running app's executable identity cannot change in place safely.
    *IS_AD_HOC.get_or_init(|| {
        let Ok(output) = std::process::Command::new("/usr/bin/codesign")
            .args(["-dv", "--verbose=2"])
            .arg(executable)
            .output()
        else {
            return false;
        };
        let details = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        signature_details_are_ad_hoc(&details)
    })
}

#[cfg(any(target_os = "macos", test))]
fn signature_details_are_ad_hoc(details: &str) -> bool {
    details.lines().any(|line| line.trim() == "Signature=adhoc")
}

fn parse_permissions_status(stdout: &str) -> Result<PermissionsStatus, String> {
    let line = stdout.lines().last().unwrap_or("");
    serde_json::from_str(line).map_err(|e| format!("parse: {e}: {line}"))
}

async fn run_sidecar_cmd(app: &AppHandle, mode: &str) -> Result<String, String> {
    let path = super::sidecar_path(app)?;
    let mut command = tokio::process::Command::new(&path);
    command
        .arg(mode)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let child = command.spawn().map_err(|e| format!("spawn: {e}"))?;
    let fut = child.wait_with_output();
    // A human may need time to read and answer the macOS consent dialog.
    // Do not kill an interactive request using the short status-query limit.
    let timeout = if mode == "status" { 5 } else { 120 };
    match tokio::time::timeout(std::time::Duration::from_secs(timeout), fut).await {
        Ok(Ok(out)) => Ok(String::from_utf8_lossy(&out.stdout).to_string()),
        Ok(Err(e)) => Err(format!("read: {e}")),
        Err(_) => Err("sidecar timed out".into()),
    }
}

#[tauri::command]
pub async fn permissions_status(app: AppHandle) -> Result<PermissionsStatus, String> {
    let stdout = run_sidecar_cmd(&app, "status").await?;
    let mut status = parse_permissions_status(&stdout)?;
    #[cfg(target_os = "macos")]
    {
        if let Ok(host) = std::env::current_exe() {
            status.ad_hoc_signature = macos_is_ad_hoc_signed(&host);
            status.app_path = host
                .ancestors()
                .find(|p| p.extension().is_some_and(|ext| ext == "app"))
                .unwrap_or(&host)
                .to_string_lossy()
                .into_owned();
        }
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::{parse_permissions_status, signature_details_are_ad_hoc};

    #[test]
    fn identifies_ad_hoc_signatures_for_permission_diagnostics() {
        assert!(signature_details_are_ad_hoc(
            "Executable=/Applications/HoneyVoice.app/Contents/MacOS/humla\nSignature=adhoc\n"
        ));
        assert!(!signature_details_are_ad_hoc(
            "Executable=/Applications/HoneyVoice.app/Contents/MacOS/humla\nAuthority=Developer ID Application\n"
        ));
    }

    #[test]
    fn permission_status_uses_stable_camel_case_ipc_field_and_defaults_old_sidecars() {
        let parsed = parse_permissions_status(
            "diagnostic output\n{\"microphone\":\"granted\",\"screen\":\"denied\"}\n",
        )
        .unwrap();
        assert!(!parsed.ad_hoc_signature);

        let json = serde_json::to_value(super::PermissionsStatus {
            microphone: "granted".into(),
            screen: "denied".into(),
            ad_hoc_signature: true,
            app_path: "/Applications/HoneyVoice.app".into(),
        })
        .unwrap();
        assert_eq!(json["adHocSignature"], true);
        assert_eq!(json["appPath"], "/Applications/HoneyVoice.app");
        assert!(json.get("permissionIdentity").is_none());
    }

    #[test]
    fn permission_state_is_taken_from_the_capture_helper_report() {
        let reported_by_capture_process =
            parse_permissions_status(r#"{"microphone":"granted","screen":"granted"}"#).unwrap();
        assert_eq!(reported_by_capture_process.microphone, "granted");
        assert_eq!(reported_by_capture_process.screen, "granted");
    }

    #[test]
    fn capture_helper_uses_the_same_tcc_bundle_identifier_as_the_app() {
        let app: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let app_id = app["identifier"].as_str().unwrap();
        let helper_plist = include_str!("../../../audio-capture/Info.plist");
        let helper_id = helper_plist
            .split("<key>CFBundleIdentifier</key>")
            .nth(1)
            .and_then(|part| part.split_once("<string>"))
            .and_then(|(_, part)| part.split_once("</string>"))
            .map(|(id, _)| id.trim())
            .unwrap();
        assert_eq!(
            helper_id, app_id,
            "TCC permissions must belong to HoneyVoice, not a separate helper identity"
        );
    }
}

#[tauri::command]
pub async fn permissions_request(
    app: AppHandle,
    kind: String,
) -> Result<PermissionsStatus, String> {
    let mode = match kind.as_str() {
        "microphone" => "request-microphone",
        "screen" => "request-screen",
        _ => return Err("unknown kind".into()),
    };
    // Use the same launch/attribution path as actual capture. Never detach the
    // helper or try to infer an authorization failure from its code hash.
    let _ = run_sidecar_cmd(&app, mode).await?;
    permissions_status(app).await
}

#[tauri::command]
pub async fn permissions_open_settings(kind: String) -> Result<(), String> {
    let url = match kind.as_str() {
        "microphone" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        "screen" => "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
        _ => return Err("unknown kind".into()),
    };
    tokio::process::Command::new("open")
        .arg(url)
        .spawn()
        .map_err(|e| format!("open: {e}"))?
        .wait()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
