//! "Report a problem": a short text plus the masked diagnostics, sent to Luft
//! over the friends connection. The preview shows exactly what is sent.
use luft_listen_together::{
    ProblemReport, ProblemReportInput, ProblemReportSummary, reports::MAX_REPORT_DIAGNOSTICS_BYTES,
};
use serde_json::{Value, json};
use tauri::{AppHandle, State};

use crate::{commands::diagnostics::diagnostics_report, error::CommandError, state::AppState};

/// The technical details as they would be sent.
#[tauri::command]
pub async fn problem_report_preview(app: AppHandle, state: State<'_, AppState>) -> Result<String, CommandError> {
    let compact = fitted(diagnostics_report(&app, &state).await);
    let value: Value = serde_json::from_str(&compact).map_err(|error| CommandError::internal(error.to_string()))?;
    serde_json::to_string_pretty(&value).map_err(|error| CommandError::internal(error.to_string()))
}

#[tauri::command]
pub async fn problem_report_send(
    message: String,
    include_details: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<ProblemReportSummary, CommandError> {
    let diagnostics = if include_details { fitted(diagnostics_report(&app, &state).await) } else { String::new() };
    let mut input = ProblemReportInput { message, app_version: app.package_info().version.to_string(), diagnostics };
    if !input.validate() {
        return Err(CommandError::internal("friends.error.invalidReport"));
    }
    state.friends.submit_report(&input).await.map_err(CommandError::internal)
}

#[tauri::command]
pub async fn problem_reports_list(state: State<'_, AppState>) -> Result<Vec<ProblemReportSummary>, CommandError> {
    state.friends.reports().await.map_err(CommandError::internal)
}

#[tauri::command]
pub async fn problem_report_get(id: String, state: State<'_, AppState>) -> Result<ProblemReport, CommandError> {
    state.friends.report(&id).await.map_err(CommandError::internal)
}

#[tauri::command]
pub async fn problem_report_delete(id: String, state: State<'_, AppState>) -> Result<(), CommandError> {
    state.friends.delete_report(&id).await.map_err(CommandError::internal)
}

/// Compact JSON within the server's limit. The older log context goes
/// first, then the recent lines, then the oldest problems; the status
/// sections always stay.
fn fitted(mut report: Value) -> String {
    let fits = |report: &Value| serde_json::to_string(report).map(|text| (text.len() <= MAX_REPORT_DIAGNOSTICS_BYTES).then_some(text));
    if let Ok(Some(text)) = fits(&report) {
        return text;
    }
    if let Some(log) = report.get_mut("log").and_then(Value::as_object_mut) {
        log.remove("earlier");
    }
    if let Some(run) = report.pointer_mut("/log/currentRun").and_then(Value::as_object_mut) {
        run.remove("recent");
    }
    loop {
        if let Ok(Some(text)) = fits(&report) {
            return text;
        }
        let Some(problems) = report.pointer_mut("/log/currentRun/problems").and_then(Value::as_array_mut).filter(|list| !list.is_empty()) else {
            break;
        };
        problems.remove(0);
    }
    report["log"] = json!({ "available": false, "reason": "too large to send" });
    serde_json::to_string(&report).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_logs_are_trimmed_to_fit() {
        let line = "x".repeat(2_000);
        let problems: Vec<Value> = (0..40).map(|n| json!({ "n": n, "message": line })).collect();
        let report = json!({
            "appVersion": "0.1.5",
            "log": {
                "currentRun": { "levels": { "WARN": 40 }, "problems": problems, "recent": vec![line.clone(); 30] },
                "earlier": { "recent": vec![line.clone(); 30] },
            },
        });
        let text = fitted(report);
        assert!(text.len() <= MAX_REPORT_DIAGNOSTICS_BYTES);
        let value: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["appVersion"], "0.1.5");
        assert!(value["log"].get("earlier").is_none());
        // The newest problems stay.
        assert_eq!(value["log"]["currentRun"]["problems"].as_array().unwrap().last().unwrap()["n"], 39);

        let small = json!({ "appVersion": "0.1.5", "log": { "currentRun": { "recent": ["a"] } } });
        assert_eq!(serde_json::from_str::<Value>(&fitted(small.clone())).unwrap(), small);
    }
}
