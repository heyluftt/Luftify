use std::path::Path;

use tracing_appender::rolling::{RollingFileAppender, Rotation};
use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

/// Stream probing (symphonia), Connect's per-load "context not available" and
/// "Activate will be ignored while already active" fire for every track and
/// buried the diagnostics that explain real faults.
const DEFAULT_FILTER: &str = "info,symphonia=error,librespot_connect::state::context=error,librespot_connect::spirc=error";
const LOG_PREFIX: &str = "luft-player.jsonl";
/// Two weeks of logs are plenty for a problem report; older days used to pile
/// up (220 MB after three months).
const KEPT_DAYS: usize = 14;

pub struct LoggingGuard {
    _guard: tracing_appender::non_blocking::WorkerGuard,
}

pub fn init_logging(log_dir: &Path) -> Result<LoggingGuard, std::io::Error> {
    std::fs::create_dir_all(log_dir)?;
    // The appender prunes on each new day; this also catches a PC that was off.
    prune_old_logs(log_dir, KEPT_DAYS);
    let appender = RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(LOG_PREFIX)
        .max_log_files(KEPT_DAYS)
        .build(log_dir)
        .map_err(std::io::Error::other)?;
    let (writer, guard) = tracing_appender::non_blocking(appender);
    tracing_subscriber::registry()
        .with(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_FILTER)))
        .with(tracing_subscriber::fmt::layer().json().with_writer(writer))
        .try_init()
        .ok();
    Ok(LoggingGuard { _guard: guard })
}

/// Deletes all but the newest `keep` daily logs (`luft-player.jsonl.YYYY-MM-DD`).
/// Only those files are touched; the dates in the names sort by age.
fn prune_old_logs(log_dir: &Path, keep: usize) {
    let Ok(entries) = std::fs::read_dir(log_dir) else { return };
    let mut days: Vec<(String, std::path::PathBuf)> = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let date = name.strip_prefix(LOG_PREFIX)?.strip_prefix('.')?;
            let dated = date.len() == 10 && date.bytes().enumerate().all(|(index, byte)| if index == 4 || index == 7 { byte == b'-' } else { byte.is_ascii_digit() });
            dated.then(|| (date.to_owned(), entry.path()))
        })
        .collect();
    if days.len() <= keep {
        return;
    }
    days.sort();
    for (_, path) in &days[..days.len() - keep] {
        let _ = std::fs::remove_file(path);
    }
}

#[must_use]
pub fn redact(input: &str) -> String {
    let mut output = input.to_owned();
    for marker in [
        "pairingKey",
        "access_token",
        "authorization",
        "cookie",
        "password",
    ] {
        let lower = output.to_lowercase();
        if let Some(index) = lower.find(&marker.to_lowercase()) {
            output.truncate(index);
            output.push_str("[REDACTED]");
            break;
        }
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_the_newest_daily_logs() {
        let dir = std::env::temp_dir().join(format!("luft-logs-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for name in ["luft-player.jsonl.2026-07-15", "luft-player.jsonl.2026-10-05", "luft-player.jsonl.2026-10-06", "startup-latest.jsonl", "luft-player.jsonl.notes"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        prune_old_logs(&dir, 2);
        let mut left: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|entry| entry.unwrap().file_name().into_string().unwrap()).collect();
        left.sort();
        assert_eq!(left, ["luft-player.jsonl.2026-10-05", "luft-player.jsonl.2026-10-06", "luft-player.jsonl.notes", "startup-latest.jsonl"]);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn removes_sensitive_suffixes() {
        assert_eq!(redact("failure pairingKey=secret"), "failure [REDACTED]");
        assert_eq!(redact("safe timeout"), "safe timeout");
    }
}
