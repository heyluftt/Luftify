//! "Report a problem": friends of Luft send a short description with the
//! app's masked diagnostics; only Luft reads them. Bounded on every side, so
//! the server cannot be filled or flooded with them.
use serde::{Deserialize, Serialize};

pub const MAX_REPORT_MESSAGE_CHARS: usize = 1000;
/// The masked diagnostics as JSON text; leaves room inside MAX_MESSAGE_BYTES.
pub const MAX_REPORT_DIAGNOSTICS_BYTES: usize = 48 * 1024;
/// Per sender within 24 hours.
pub const REPORTS_PER_DAY: i64 = 3;
/// Stored at most; new reports wait until Luft has cleared some.
pub const MAX_STORED_REPORTS: i64 = 200;
pub const REPORT_TTL_MS: i64 = 30 * 24 * 60 * 60_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemReportInput {
    pub message: String,
    pub app_version: String,
    /// Empty when the sender left the technical details out.
    #[serde(default)]
    pub diagnostics: String,
}

impl ProblemReportInput {
    /// Trims the message; false when something is out of bounds.
    pub fn validate(&mut self) -> bool {
        self.message = self.message.trim().to_owned();
        let length = self.message.chars().count();
        (1..=MAX_REPORT_MESSAGE_CHARS).contains(&length)
            && !self.message.chars().any(|c| c.is_control() && c != '\n')
            && valid_version(&self.app_version)
            && self.diagnostics.len() <= MAX_REPORT_DIAGNOSTICS_BYTES
            && (self.diagnostics.is_empty()
                || serde_json::from_str::<serde_json::Value>(&self.diagnostics).is_ok_and(|v| v.is_object()))
    }
}

fn valid_version(version: &str) -> bool {
    let parts: Vec<&str> = version.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| (1..=4).contains(&part.len()) && part.bytes().all(|b| b.is_ascii_digit()))
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemReportSummary {
    pub id: String,
    pub reporter_id: String,
    pub reporter_name: String,
    pub message: String,
    pub app_version: String,
    pub created_at_ms: i64,
    pub has_diagnostics: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProblemReport {
    #[serde(flatten)]
    pub summary: ProblemReportSummary,
    pub diagnostics: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(message: &str, version: &str, diagnostics: &str) -> ProblemReportInput {
        ProblemReportInput { message: message.into(), app_version: version.into(), diagnostics: diagnostics.into() }
    }

    #[test]
    fn reports_stay_within_bounds() {
        let mut ok = input("  Musik stoppt nach dem Skippen\nimmer wieder ", "0.1.5", r#"{"log":{}}"#);
        assert!(ok.validate());
        assert_eq!(ok.message, "Musik stoppt nach dem Skippen\nimmer wieder");
        assert!(input("ohne Details", "0.1.5", "").validate());

        assert!(!input("   ", "0.1.5", "").validate());
        assert!(!input(&"x".repeat(MAX_REPORT_MESSAGE_CHARS + 1), "0.1.5", "").validate());
        assert!(!input("bell\u{7}", "0.1.5", "").validate());
        assert!(!input("text", "0.1", "").validate());
        assert!(!input("text", "1.2.x", "").validate());
        assert!(!input("text", "0.1.5", "[1,2]").validate());
        assert!(!input("text", "0.1.5", "not json").validate());
        let big = format!(r#"{{"a":"{}"}}"#, "x".repeat(MAX_REPORT_DIAGNOSTICS_BYTES));
        assert!(!input("text", "0.1.5", &big).validate());
    }
}
