//! The part of the app log a diagnosis needs: which warnings and errors
//! happened how often, and the latest of them in order. Routine INFO lines
//! (every rootlist refresh) crowded the old catalog excerpt and hid the
//! warnings that explained the problem.

use super::privacy::Redactor;
use serde_json::{Map, Value, json};
use std::{collections::HashMap, io::SeekFrom, path::Path, path::PathBuf, time::SystemTime};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

/// Read budget across the newest log files (one file per day).
const MAX_LOG_TAIL_BYTES: u64 = 2_000_000;
const MAX_LOG_FILES: usize = 2;
const MAX_PROBLEMS: usize = 40;
const MAX_EARLIER_PROBLEMS: usize = 15;
const MAX_RECENT: usize = 60;
const MAX_TEXT_CHARS: usize = 600;

/// Fields that only name tracks, playlists or internal plumbing: the
/// listening history stays out, the counters and errors stay in.
fn private_or_noise(key: &str) -> bool {
    key.contains("uri")
        || key.ends_with("request_id")
        || key.starts_with("log.")
        || key.starts_with("db.")
        || matches!(key, "playlist_id" | "preview" | "summary" | "device" | "message")
}

pub(super) async fn log_summary(log_dir: &Path, redactor: &Redactor) -> Value {
    let files = match newest_log_files(log_dir).await {
        Ok(files) if !files.is_empty() => files,
        Ok(_) => return json!({ "available": false, "reason": "no app log yet" }),
        Err(error) => {
            return json!({ "available": false, "reason": format!("log folder unreadable: {error}") });
        }
    };
    let mut budget = MAX_LOG_TAIL_BYTES;
    let mut chunks = Vec::new();
    let mut names = Vec::new();
    for path in &files {
        if budget == 0 {
            break;
        }
        match read_log_tail(path, budget).await {
            Ok((contents, read)) => {
                budget = budget.saturating_sub(read);
                names.push(file_name(path));
                chunks.push(contents);
            }
            Err(error) => {
                return json!({ "available": false, "reason": format!("app log unreadable: {error}") });
            }
        }
    }
    // Oldest first, so counts and "recent" follow the timeline.
    chunks.reverse();
    names.reverse();
    let events = chunks
        .iter()
        .flat_map(|chunk| chunk.lines())
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .collect::<Vec<_>>();
    summarize(&events, names, redactor)
}

/// Splits at the latest app start: what happens in the running app is the
/// diagnosis, older lines (often from an earlier build) are only context.
fn summarize(events: &[Value], files: Vec<String>, redactor: &Redactor) -> Value {
    let start = events.iter().rposition(is_app_start);
    let split = start.unwrap_or(0);
    let (earlier, current) = events.split_at(split);
    let mut current_run = section(current, redactor, MAX_PROBLEMS, true);
    current_run["startedAt"] = json!(start.map(|index| text(&events[index], "timestamp")));
    json!({
        "available": true,
        "files": files,
        "currentRun": current_run,
        "earlier": (!earlier.is_empty())
            .then(|| section(earlier, redactor, MAX_EARLIER_PROBLEMS, false)),
    })
}

fn is_app_start(event: &Value) -> bool {
    text(event, "target").starts_with("luft_desktop_lib")
        && event.pointer("/fields/message").and_then(Value::as_str) == Some("startup timing")
        && event.pointer("/fields/phase").and_then(Value::as_str) == Some("backend-started")
}

fn section(events: &[Value], redactor: &Redactor, max_problems: usize, detailed: bool) -> Value {
    let mut levels = Map::new();
    let mut problems: HashMap<(String, String, String), Problem> = HashMap::new();
    let mut recent = Vec::new();
    for event in events {
        let level = text(event, "level");
        let count = levels.entry(level.clone()).or_insert(json!(0));
        *count = json!(count.as_u64().unwrap_or(0) + 1);
        if level != "WARN" && level != "ERROR" {
            continue;
        }
        let target = text(event, "target");
        let timestamp = text(event, "timestamp");
        let message = event
            .pointer("/fields/message")
            .and_then(Value::as_str)
            .map(|message| truncate(&redactor.text(message), MAX_TEXT_CHARS))
            .unwrap_or_default();
        let key = (level.clone(), target.clone(), group_key(&message));
        let problem = problems.entry(key).or_insert_with(|| Problem {
            first: timestamp.clone(),
            ..Problem::default()
        });
        problem.count += 1;
        problem.last.clone_from(&timestamp);
        problem.message.clone_from(&message);
        if detailed {
            let details = details(event, redactor);
            problem.example = Some(details.clone());
            recent.push(json!({
                "timestamp": timestamp,
                "level": level,
                "target": target,
                "message": message,
                "details": details,
            }));
        }
    }
    let mut problems = problems.into_iter().collect::<Vec<_>>();
    problems.sort_by(|(_, left), (_, right)| {
        right.count.cmp(&left.count).then_with(|| right.last.cmp(&left.last))
    });
    let problem_groups = problems.len();
    let problems = problems
        .into_iter()
        .take(max_problems)
        .map(|((level, target, _), problem)| {
            let mut entry = json!({
                "level": level,
                "target": target,
                "message": problem.message,
                "count": problem.count,
                "first": problem.first,
                "last": problem.last,
            });
            if let Some(example) = problem.example {
                entry["example"] = example;
            }
            entry
        })
        .collect::<Vec<_>>();
    let mut section = json!({
        "from": events.first().map(|event| text(event, "timestamp")),
        "to": events.last().map(|event| text(event, "timestamp")),
        "lines": events.len(),
        "levels": levels,
        "problemGroups": problem_groups,
        "problems": problems,
    });
    if detailed {
        let skip = recent.len().saturating_sub(MAX_RECENT);
        section["recent"] = Value::Array(recent.into_iter().skip(skip).collect());
    }
    section
}

#[derive(Default)]
struct Problem {
    count: u64,
    /// The latest wording; the group key has its numbers blanked.
    message: String,
    first: String,
    last: String,
    example: Option<Value>,
}

/// Messages that differ only by numbers ("retrying in 4 seconds") group.
fn group_key(message: &str) -> String {
    let mut key = String::with_capacity(message.len());
    let mut in_number = false;
    for character in message.chars().take(160) {
        if character.is_ascii_digit() {
            if !in_number {
                key.push('#');
            }
            in_number = true;
        } else {
            in_number = false;
            key.push(character);
        }
    }
    key
}

fn details(event: &Value, redactor: &Redactor) -> Value {
    let Some(fields) = event.get("fields").and_then(Value::as_object) else {
        return json!({});
    };
    let mut details = Map::new();
    for (key, value) in fields {
        if private_or_noise(key) {
            continue;
        }
        let value = match value {
            Value::String(text) => tidy(&truncate(&redactor.text(text), MAX_TEXT_CHARS)),
            Value::Number(_) | Value::Bool(_) | Value::Null => value.clone(),
            _ => continue,
        };
        details.insert(key.clone(), value);
    }
    Value::Object(details)
}

/// tracing records `u128` durations and `?Option` fields as text; turn
/// "412" and "Some(36)" back into the numbers they are.
fn tidy(text: &str) -> Value {
    let inner = text
        .strip_prefix("Some(")
        .and_then(|rest| rest.strip_suffix(')'))
        .unwrap_or(text);
    if text == "None" {
        return Value::Null;
    }
    if let Ok(number) = inner.parse::<u64>() {
        return json!(number);
    }
    match inner {
        "true" => json!(true),
        "false" => json!(false),
        _ => Value::String(inner.to_owned()),
    }
}

fn text(event: &Value, key: &str) -> String {
    event
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

async fn newest_log_files(log_dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut entries = tokio::fs::read_dir(log_dir).await?;
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next_entry().await {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("luft-player.jsonl") {
            continue;
        }
        let modified = entry
            .metadata()
            .await
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        files.push((modified, entry.path()));
    }
    files.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(files
        .into_iter()
        .take(MAX_LOG_FILES)
        .map(|(_, path)| path)
        .collect())
}

async fn read_log_tail(path: &Path, budget: u64) -> Result<(String, u64), std::io::Error> {
    let mut file = tokio::fs::File::open(path).await?;
    let length = file.metadata().await?.len();
    let start = length.saturating_sub(budget);
    if start > 0 {
        file.seek(SeekFrom::Start(start)).await?;
    }
    let mut bytes = Vec::with_capacity((length - start) as usize);
    file.take(budget).read_to_end(&mut bytes).await?;
    let read = bytes.len() as u64;
    let mut contents = String::from_utf8_lossy(&bytes).into_owned();
    if start > 0
        && let Some(first_line_end) = contents.find('\n')
    {
        contents.drain(..=first_line_end);
    }
    Ok((contents, read))
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut chars = value.chars();
    let shortened = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{shortened}…")
    } else {
        shortened
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(level: &str, message: &str, fields: Value) -> Value {
        let mut all = fields.as_object().cloned().unwrap_or_default();
        all.insert("message".into(), json!(message));
        json!({
            "timestamp": "2026-09-28T18:07:35Z",
            "level": level,
            "target": "luft_librespot::catalog",
            "fields": all,
        })
    }

    #[test]
    fn groups_warnings_and_keeps_listening_history_out() {
        let events = vec![
            event("INFO", "librespot playlists loaded", json!({ "items": 36 })),
            event("WARN", "Rate limited, retrying in 4 seconds...", json!({})),
            event("WARN", "Rate limited, retrying in 9 seconds...", json!({})),
            event(
                "ERROR",
                "rootlist failed",
                json!({ "elapsed_ms": "2382", "contents_pos": "Some(0)", "track_uri": "spotify:track:1AtVFx9tRuBBWUp8NkWe8H" }),
            ),
        ];
        let summary = summarize(&events, vec!["log".into()], &Redactor::new(None))["currentRun"].clone();
        assert_eq!(summary["levels"]["INFO"], 1);
        assert_eq!(summary["levels"]["WARN"], 2);
        assert_eq!(summary["problemGroups"], 2);
        assert_eq!(summary["problems"][0]["message"], "Rate limited, retrying in 9 seconds...");
        assert_eq!(summary["problems"][0]["count"], 2);
        let example = &summary["problems"][1]["example"];
        assert_eq!(example["elapsed_ms"], 2382);
        assert_eq!(example["contents_pos"], 0);
        assert!(example.get("track_uri").is_none());
        assert_eq!(summary["recent"].as_array().map(Vec::len), Some(3));
    }

    #[test]
    fn separates_the_running_app_from_earlier_starts() {
        let mut start = event("INFO", "startup timing", json!({ "phase": "backend-started" }));
        start["target"] = json!("luft_desktop_lib::startup");
        let events = vec![
            event("WARN", "old build warning", json!({})),
            start,
            event("WARN", "current warning", json!({})),
        ];
        let summary = summarize(&events, Vec::new(), &Redactor::new(None));
        assert_eq!(summary["currentRun"]["problems"][0]["message"], "current warning");
        assert_eq!(summary["currentRun"]["problemGroups"], 1);
        assert_eq!(summary["earlier"]["problems"][0]["message"], "old build warning");
        assert!(summary["earlier"].get("recent").is_none());
    }
}
