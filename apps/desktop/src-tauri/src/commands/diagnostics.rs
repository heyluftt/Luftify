mod log_summary;
mod privacy;

use log_summary::log_summary;
use privacy::Redactor;

use chrono::Utc;
use luft_infrastructure::product_config;
use serde::Serialize;
use serde_json::{Value, json};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

use crate::{error::CommandError, state::AppState};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsExport {
    path: String,
    /// Since the app started, so the page can say whether anything is off.
    warnings: u64,
    errors: u64,
}

#[tauri::command]
pub async fn export_diagnostics(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DiagnosticsExport, CommandError> {
    let report = diagnostics_report(&app, &state).await;
    let current = report.pointer("/log/currentRun/levels");
    let count = |level: &str| {
        current
            .and_then(|levels| levels.get(level))
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    let (warnings, errors) = (count("WARN"), count("ERROR"));
    let directory = reports_directory(&state);
    tokio::fs::create_dir_all(&directory)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    let path = directory.join(format!(
        "diagnostics-{}.json",
        Utc::now().format("%Y%m%d-%H%M%S-%f")
    ));
    let bytes = serde_json::to_vec_pretty(&report)
        .map_err(|error| CommandError::internal(error.to_string()))?;
    tokio::fs::write(&path, bytes)
        .await
        .map_err(|error| CommandError::internal(error.to_string()))?;
    Ok(DiagnosticsExport {
        path: path.to_string_lossy().into_owned(),
        warnings,
        errors,
    })
}

/// The masked status snapshot shared by the export and problem reports.
pub(crate) async fn diagnostics_report(app: &AppHandle, state: &AppState) -> Value {
    let librespot = state.librespot.status().await;
    let redactor = Redactor::new(librespot.username.as_deref());
    let log = log_summary(&state.paths.logs, &redactor).await;
    let mut report = json!({
        "schemaVersion": 4,
        "product": product_config().name,
        // The released version; the crate version is not bumped per release.
        "appVersion": app.package_info().version.to_string(),
        "createdAt": Utc::now().to_rfc3339(),
        "system": { "os": std::env::consts::OS, "arch": std::env::consts::ARCH },
        "mockMode": state.mock_mode,
        "playbackEngine": "librespot",
        "startup": state.startup.current(),
        "librespot": librespot,
        "log": log,
        "previousSession": state.session.diagnostics(),
        "notes": "Local status snapshot with the app log's warnings and errors; not an audio or network test. User name, profile path, device ids, search terms and Spotify ids are masked. Review before sharing.",
    });
    redactor.report(&mut report);
    report
}

/// Shows an exported report selected in Explorer. Only files inside the
/// Diagnostics folder qualify; the page never opens arbitrary paths.
#[tauri::command]
pub async fn reveal_diagnostics_report(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), CommandError> {
    let report = report_inside(&reports_directory(&state), Path::new(&path))
        .ok_or_else(|| CommandError::internal("Bericht nicht gefunden."))?;
    let mut explorer = std::process::Command::new("explorer.exe");
    // Explorer wants `/select,"path"` verbatim; regular argument quoting
    // would wrap the whole switch.
    #[cfg(windows)]
    std::os::windows::process::CommandExt::raw_arg(
        &mut explorer,
        format!("/select,\"{}\"", report.display()),
    );
    #[cfg(not(windows))]
    explorer.arg(&report);
    explorer
        .spawn()
        .map(|_| ())
        .map_err(|error| CommandError::internal(error.to_string()))
}

fn reports_directory(state: &AppState) -> PathBuf {
    state.paths.data.join("Diagnostics")
}

fn report_inside(directory: &Path, path: &Path) -> Option<PathBuf> {
    let directory = directory.canonicalize().ok()?;
    let report = path.canonicalize().ok()?;
    let is_report = report
        .extension()
        .is_some_and(|extension| extension == "json");
    (report.starts_with(&directory) && report.is_file() && is_report).then(|| {
        // `canonicalize` adds the `\\?\` prefix, which Explorer does not accept.
        PathBuf::from(report.to_string_lossy().trim_start_matches(r"\\?\"))
    })
}

#[cfg(test)]
mod tests {
    use super::report_inside;

    #[test]
    fn only_json_reports_inside_the_folder_qualify() {
        let root = std::env::temp_dir().join(format!("luft-diagnostics-{}", std::process::id()));
        let reports = root.join("Diagnostics");
        std::fs::create_dir_all(&reports).unwrap();
        std::fs::write(reports.join("report.json"), "{}").unwrap();
        std::fs::write(reports.join("notes.txt"), "").unwrap();
        std::fs::write(root.join("outside.json"), "{}").unwrap();

        let found = report_inside(&reports, &reports.join("report.json")).unwrap();
        assert!(!found.to_string_lossy().starts_with(r"\?\"));
        assert!(report_inside(&reports, &reports.join("notes.txt")).is_none());
        assert!(report_inside(&reports, &reports.join("..").join("outside.json")).is_none());
        assert!(report_inside(&reports, &reports.join("missing.json")).is_none());
        std::fs::remove_dir_all(&root).unwrap();
    }
}
