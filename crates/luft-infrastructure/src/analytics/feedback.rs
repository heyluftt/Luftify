use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::database::{Database, DatabaseError};

/// SQLite keeps the bound-parameter count bounded; stay well below it.
const FEEDBACK_CHUNK: usize = 400;
pub const MAX_FEEDBACK_URIS: usize = 2_000;
/// Clicking through a queue is not a judgment about the title.
const BRIEF_SKIP_MS: i64 = 4_000;

/// Raw per-title listening signals. Interpretation (known, sampled, skipped,
/// time decay) belongs to the caller, so nothing here becomes a blacklist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackListeningFeedback {
    pub uri: String,
    pub qualified_play_count: u64,
    pub completed_count: u64,
    /// Early exits after at least `BRIEF_SKIP_MS`; pass-through clicks are ignored.
    pub skip_count: u64,
    pub last_qualified_at_ms: Option<i64>,
    pub last_skipped_at_ms: Option<i64>,
    /// Furthest single listen, so a late skip still reads as enjoyed.
    pub max_listened_ms: u64,
    pub duration_ms: Option<u64>,
}

impl Database {
    /// Titles without any session are omitted from the result.
    pub async fn track_listening_feedback(
        &self,
        uris: &[String],
    ) -> Result<Vec<TrackListeningFeedback>, DatabaseError> {
        let mut feedback = Vec::new();
        for chunk in uris.chunks(FEEDBACK_CHUNK) {
            let placeholders = vec!["?"; chunk.len()].join(",");
            // Skip matches the overview's skip_count, minus pass-through clicks.
            let sql = format!(
                "SELECT
                    sessions.track_uri,
                    SUM(CASE WHEN sessions.qualified_play <> 0 THEN 1 ELSE 0 END) AS qualified,
                    SUM(CASE WHEN sessions.completed <> 0 THEN 1 ELSE 0 END) AS completed,
                    SUM(CASE WHEN {SKIP} THEN 1 ELSE 0 END) AS skips,
                    MAX(CASE WHEN sessions.qualified_play <> 0
                        THEN sessions.started_at_ms END) AS last_qualified,
                    MAX(CASE WHEN {SKIP} THEN sessions.started_at_ms END) AS last_skipped,
                    MAX(sessions.listened_ms) AS max_listened,
                    MAX(tracks.duration_ms) AS duration_ms
                 FROM listening_sessions sessions
                 LEFT JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
                 WHERE sessions.track_uri IN ({placeholders})
                 GROUP BY sessions.track_uri",
                SKIP = format!(
                    "sessions.qualified_play = 0
                     AND sessions.end_reason IN ('track-changed', 'player-empty')
                     AND sessions.listened_ms >= {BRIEF_SKIP_MS}"
                ),
            );
            let mut query = sqlx::query(&sql);
            for uri in chunk {
                query = query.bind(uri);
            }
            for row in query.fetch_all(self.pool()).await? {
                feedback.push(TrackListeningFeedback {
                    uri: row.try_get("track_uri")?,
                    qualified_play_count: super::non_negative(row.try_get("qualified")?),
                    completed_count: super::non_negative(row.try_get("completed")?),
                    skip_count: super::non_negative(row.try_get("skips")?),
                    last_qualified_at_ms: row.try_get("last_qualified")?,
                    last_skipped_at_ms: row.try_get("last_skipped")?,
                    max_listened_ms: super::non_negative(row.try_get("max_listened")?),
                    duration_ms: super::optional_non_negative(row.try_get("duration_ms")?),
                });
            }
        }
        Ok(feedback)
    }
}
