//! Small previews for the recap overview: a few covers, the top song and the
//! top artist per period. Cheap on purpose; the full recap loads on opening.

use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::database::{Database, DatabaseError};

/// More periods than the overview ever shows at once.
const MAX_PREVIEW_RANGES: usize = 48;
const PREVIEW_COVERS: i64 = 4;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapPreviewRange {
    pub id: String,
    pub from_unix_ms: i64,
    pub to_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapPreview {
    pub id: String,
    /// Covers of the most played albums, most played first, no duplicates.
    pub cover_uris: Vec<String>,
    pub top_track_title: Option<String>,
    pub top_artist_name: Option<String>,
}

impl Database {
    pub async fn recap_previews(&self, ranges: Vec<RecapPreviewRange>) -> Result<Vec<RecapPreview>, DatabaseError> {
        let mut previews = Vec::with_capacity(ranges.len().min(MAX_PREVIEW_RANGES));
        for range in ranges.into_iter().take(MAX_PREVIEW_RANGES) {
            if range.to_unix_ms <= range.from_unix_ms {
                continue;
            }
            previews.push(self.recap_preview(range).await?);
        }
        Ok(previews)
    }

    async fn recap_preview(&self, range: RecapPreviewRange) -> Result<RecapPreview, DatabaseError> {
        let (from, to) = (range.from_unix_ms, range.to_unix_ms);
        let cover_uris = sqlx::query(
            "SELECT MAX(tracks.cover_uri) AS cover_uri, SUM(sessions.listened_ms) AS listening_ms
             FROM listening_sessions sessions
             JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
             WHERE sessions.qualified_play <> 0
               AND sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
               AND tracks.cover_uri IS NOT NULL AND TRIM(tracks.cover_uri) <> ''
             GROUP BY COALESCE(tracks.album_uri, tracks.cover_uri)
             ORDER BY listening_ms DESC
             LIMIT ?",
        )
        .bind(from)
        .bind(to)
        .bind(PREVIEW_COVERS)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(|row| row.try_get::<String, _>("cover_uri"))
        .collect::<Result<Vec<_>, _>>()?;

        let top_track_title = sqlx::query(
            "SELECT MAX(tracks.title) AS title, SUM(sessions.listened_ms) AS listening_ms
             FROM listening_sessions sessions
             JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
             WHERE sessions.qualified_play <> 0
               AND sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
             GROUP BY sessions.track_uri
             ORDER BY listening_ms DESC
             LIMIT 1",
        )
        .bind(from)
        .bind(to)
        .fetch_optional(self.pool())
        .await?
        .map(|row| row.try_get::<Option<String>, _>("title"))
        .transpose()?
        .flatten();

        let top_artist_name = sqlx::query(
            "SELECT MAX(creators.creator_name) AS creator_name, SUM(sessions.listened_ms) AS listening_ms
             FROM listening_sessions sessions
             JOIN analytics_track_creators creators ON creators.track_uri = sessions.track_uri
             WHERE sessions.qualified_play <> 0
               AND sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
             GROUP BY creators.creator_key
             ORDER BY listening_ms DESC
             LIMIT 1",
        )
        .bind(from)
        .bind(to)
        .fetch_optional(self.pool())
        .await?
        .map(|row| row.try_get::<Option<String>, _>("creator_name"))
        .transpose()?
        .flatten();

        Ok(RecapPreview {
            id: range.id,
            cover_uris,
            top_track_title,
            top_artist_name,
        })
    }
}
