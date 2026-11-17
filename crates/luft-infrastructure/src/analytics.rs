use std::collections::{HashMap, HashSet};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::Row;

use crate::database::{Database, DatabaseError};

mod feedback;
mod play_count;
mod recap;
mod recap_preview;
mod recent;
pub use recap::{ListeningRecap, RecapAlbum, RecapDiscovery, RecapRequest, RecapTrackDay};
pub use recap_preview::{RecapPreview, RecapPreviewRange};
pub use feedback::{MAX_FEEDBACK_URIS, TrackListeningFeedback};

const DEFAULT_RESULT_LIMIT: u32 = 10;
const MAX_RESULT_LIMIT: u32 = 100;
const MIN_TIMEZONE_OFFSET_MINUTES: i32 = -14 * 60;
const MAX_TIMEZONE_OFFSET_MINUTES: i32 = 14 * 60;
const MILLIS_PER_DAY: i64 = 86_400_000;
const MILLIS_PER_HOUR: i64 = 3_600_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AnalyticsRangeRequest {
    pub from_unix_ms: Option<i64>,
    pub to_unix_ms: Option<i64>,
    pub limit: u32,
    pub timezone_offset_minutes: i32,
}

impl Default for AnalyticsRangeRequest {
    fn default() -> Self {
        Self {
            from_unix_ms: None,
            to_unix_ms: None,
            limit: DEFAULT_RESULT_LIMIT,
            timezone_offset_minutes: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Creator {
    pub name: String,
    pub uri: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackSnapshot {
    pub uri: String,
    pub item_type: String,
    pub title: String,
    pub creators: Vec<Creator>,
    pub album_uri: Option<String>,
    pub album_name: Option<String>,
    pub duration_ms: Option<u64>,
    pub cover_uri: Option<String>,
}

impl TrackSnapshot {
    #[must_use]
    pub fn has_placeholder_title(&self) -> bool {
        is_placeholder_track_title(&self.title, &self.uri)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningSessionRecord {
    pub id: String,
    pub track: TrackSnapshot,
    pub context_uri: Option<String>,
    pub context_name: Option<String>,
    pub context_type: String,
    pub source: String,
    pub started_at_ms: i64,
    pub ended_at_ms: Option<i64>,
    pub start_position_ms: Option<u64>,
    pub end_position_ms: Option<u64>,
    pub listened_ms: u64,
    pub qualified_play: bool,
    pub completed: bool,
    pub seek_count: u32,
    pub pause_count: u32,
    pub repeat_cycle: u32,
    pub end_reason: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackListeningStat {
    pub track: TrackSnapshot,
    pub listening_ms: u64,
    pub session_count: u64,
    pub play_count: u64,
    pub completed_count: u64,
    pub last_played_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtistListeningStat {
    pub creator: Creator,
    pub listening_ms: u64,
    pub session_count: u64,
    pub play_count: u64,
    pub completed_count: u64,
    pub last_played_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistListeningStat {
    pub playlist_uri: String,
    pub playlist_name: Option<String>,
    pub listening_ms: u64,
    pub session_count: u64,
    pub play_count: u64,
    pub completed_count: u64,
    pub last_played_at_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyListeningActivity {
    pub day_start_ms: i64,
    pub listening_ms: u64,
    pub session_count: u64,
    pub play_count: u64,
}

/// Listening time by local hour of day (0-23), summed over the range.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyListeningActivity {
    pub hour: u8,
    pub listening_ms: u64,
    pub play_count: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningBehavior {
    /// Listening time per started title, early skips included.
    pub average_session_ms: u64,
    /// Listening time per counted play; early skips do not dilute it.
    #[serde(default)]
    pub average_play_ms: u64,
    pub longest_session_ms: u64,
    pub skip_count: u64,
    pub seek_count: u64,
    pub pause_count: u64,
    pub repeat_count: u64,
    pub active_day_count: u64,
    /// Ratio from 0.0 to 1.0, based on completed qualified plays.
    pub completion_rate: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningOverview {
    pub from_unix_ms: i64,
    pub to_unix_ms: i64,
    pub total_listening_ms: u64,
    pub session_count: u64,
    pub qualified_play_count: u64,
    pub completed_play_count: u64,
    pub unique_track_count: u64,
    pub unique_artist_count: u64,
    pub unique_playlist_count: u64,
    pub top_tracks: Vec<TrackListeningStat>,
    pub top_artists: Vec<ArtistListeningStat>,
    pub top_playlists: Vec<PlaylistListeningStat>,
    pub daily_activity: Vec<DailyListeningActivity>,
    #[serde(default)]
    pub hourly_activity: Vec<HourlyListeningActivity>,
    pub behavior: ListeningBehavior,
}

#[derive(Debug, Clone, Copy)]
struct NormalizedRange {
    from_unix_ms: i64,
    to_unix_ms: i64,
    limit: i64,
    timezone_offset_ms: i64,
}

impl AnalyticsRangeRequest {
    fn normalized(self) -> Result<NormalizedRange, DatabaseError> {
        let from_unix_ms = self.from_unix_ms.unwrap_or_default().max(0);
        let to_unix_ms = self
            .to_unix_ms
            .unwrap_or_else(|| Utc::now().timestamp_millis().saturating_add(1));
        if to_unix_ms <= from_unix_ms {
            return Err(DatabaseError::InvalidAnalytics(
                "analytics range end must be after its start",
            ));
        }
        let timezone_offset_minutes = self
            .timezone_offset_minutes
            .clamp(MIN_TIMEZONE_OFFSET_MINUTES, MAX_TIMEZONE_OFFSET_MINUTES);
        Ok(NormalizedRange {
            from_unix_ms,
            to_unix_ms,
            limit: i64::from(self.limit.clamp(1, MAX_RESULT_LIMIT)),
            timezone_offset_ms: i64::from(timezone_offset_minutes) * 60_000,
        })
    }
}

impl Database {
    pub async fn upsert_listening_session(
        &self,
        record: &ListeningSessionRecord,
    ) -> Result<(), DatabaseError> {
        validate_record(record)?;
        let mut transaction = self.pool().begin().await?;
        let now = Utc::now().timestamp_millis();
        let context_type = normalized_label(&record.context_type, "unknown");
        let source = normalized_label(&record.source, "spotifyInternal");
        upsert_track_snapshot(&mut transaction, &record.track, now).await?;

        sqlx::query(
            "INSERT INTO listening_sessions(
                session_id, track_uri, context_uri, context_name, context_type, source,
                started_at_ms, ended_at_ms, start_position_ms, end_position_ms, listened_ms,
                qualified_play, completed, seek_count, pause_count, repeat_cycle, end_reason,
                updated_at_ms
             ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
                context_uri = COALESCE(excluded.context_uri, listening_sessions.context_uri),
                context_name = COALESCE(excluded.context_name, listening_sessions.context_name),
                context_type = CASE
                    WHEN excluded.context_type <> 'unknown' THEN excluded.context_type
                    ELSE listening_sessions.context_type
                END,
                source = CASE
                    WHEN excluded.source <> '' THEN excluded.source
                    ELSE listening_sessions.source
                END,
                started_at_ms = MIN(listening_sessions.started_at_ms, excluded.started_at_ms),
                ended_at_ms = COALESCE(
                    MAX(listening_sessions.ended_at_ms, excluded.ended_at_ms),
                    listening_sessions.ended_at_ms,
                    excluded.ended_at_ms
                ),
                start_position_ms = COALESCE(
                    listening_sessions.start_position_ms,
                    excluded.start_position_ms
                ),
                end_position_ms = CASE
                    WHEN excluded.listened_ms >= listening_sessions.listened_ms
                    THEN COALESCE(
                        excluded.end_position_ms,
                        listening_sessions.end_position_ms
                    )
                    ELSE listening_sessions.end_position_ms
                END,
                listened_ms = MAX(listening_sessions.listened_ms, excluded.listened_ms),
                qualified_play = MAX(
                    listening_sessions.qualified_play,
                    excluded.qualified_play
                ),
                completed = MAX(listening_sessions.completed, excluded.completed),
                seek_count = MAX(listening_sessions.seek_count, excluded.seek_count),
                pause_count = MAX(listening_sessions.pause_count, excluded.pause_count),
                repeat_cycle = MAX(listening_sessions.repeat_cycle, excluded.repeat_cycle),
                end_reason = COALESCE(excluded.end_reason, listening_sessions.end_reason),
                updated_at_ms = MAX(
                    listening_sessions.updated_at_ms,
                    excluded.updated_at_ms
                )",
        )
        .bind(record.id.trim())
        .bind(&record.track.uri)
        .bind(trimmed_option(record.context_uri.as_deref()))
        .bind(trimmed_option(record.context_name.as_deref()))
        .bind(context_type)
        .bind(source)
        .bind(record.started_at_ms)
        .bind(record.ended_at_ms)
        .bind(record.start_position_ms.map(saturating_i64))
        .bind(record.end_position_ms.map(saturating_i64))
        .bind(saturating_i64(record.listened_ms))
        .bind(record.qualified_play)
        .bind(record.completed)
        .bind(i64::from(record.seek_count))
        .bind(i64::from(record.pause_count))
        .bind(i64::from(record.repeat_cycle))
        .bind(trimmed_option(record.end_reason.as_deref()))
        .bind(now)
        .execute(&mut *transaction)
        .await?;

        transaction.commit().await?;
        Ok(())
    }

    pub async fn repair_analytics_track_metadata(
        &self,
        track: &TrackSnapshot,
    ) -> Result<bool, DatabaseError> {
        validate_track_snapshot(track)?;
        if track.has_placeholder_title() {
            return Ok(false);
        }
        let mut transaction = self.pool().begin().await?;
        upsert_track_snapshot(&mut transaction, track, Utc::now().timestamp_millis()).await?;
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn listening_overview(
        &self,
        request: AnalyticsRangeRequest,
    ) -> Result<ListeningOverview, DatabaseError> {
        let range = request.normalized()?;
        // Sessions holding several plays (merged repeat cycles, old replays
        // counted as seeks) are expanded; see `play_count`.
        let totals = sqlx::query(&format!(
            "WITH normalized_sessions AS (
                SELECT
                    sessions.*,
                    tracks.duration_ms,
                    {plays} AS inferred_play_count,
                    {completed} AS inferred_completed_count,
                    CASE
                        WHEN tracks.duration_ms IS NOT NULL AND tracks.duration_ms > 0
                            THEN MIN(sessions.listened_ms, tracks.duration_ms)
                        ELSE sessions.listened_ms
                    END AS bounded_session_ms
                FROM listening_sessions sessions
                LEFT JOIN analytics_tracks tracks
                  ON tracks.track_uri = sessions.track_uri
                WHERE sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
             )
             SELECT
                COUNT(*) AS session_count,
                COALESCE(SUM(listened_ms), 0) AS total_listening_ms,
                COALESCE(SUM(CASE
                    WHEN qualified_play <> 0 THEN listened_ms ELSE 0
                END), 0) AS qualified_listening_ms,
                COALESCE(SUM(inferred_play_count), 0) AS qualified_play_count,
                COALESCE(SUM(inferred_completed_count), 0) AS completed_play_count,
                COALESCE(SUM(MAX(1, inferred_play_count)), 0) AS effective_session_count,
                COUNT(DISTINCT CASE
                    WHEN qualified_play <> 0 THEN track_uri
                END) AS unique_track_count,
                COUNT(DISTINCT CASE
                    WHEN qualified_play <> 0
                      AND (
                        context_type = 'playlist'
                        OR context_uri LIKE 'spotify:playlist:%'
                      )
                    THEN context_uri
                END) AS unique_playlist_count,
                COALESCE(MAX(bounded_session_ms), 0) AS longest_session_ms,
                COALESCE(SUM(CASE
                    WHEN qualified_play = 0
                      AND end_reason IN (
                        'track-changed',
                        'player-empty'
                      )
                    THEN 1 ELSE 0
                END), 0) AS skip_count,
                COALESCE(SUM(seek_count), 0) AS seek_count,
                COALESCE(SUM(pause_count), 0) AS pause_count,
                COALESCE(SUM(MAX(
                    CASE WHEN end_reason IN ('repeat', 'restart') THEN 1 ELSE 0 END,
                    inferred_play_count - 1,
                    0
                )), 0) AS repeat_count,
                COUNT(DISTINCT (
                    (started_at_ms + ?) / ?
                )) AS active_day_count
             FROM normalized_sessions",
            plays = play_count::inferred_play_count(),
            completed = play_count::inferred_completed_count(),
        ))
        .bind(range.from_unix_ms)
        .bind(range.to_unix_ms)
        .bind(range.timezone_offset_ms)
        .bind(MILLIS_PER_DAY)
        .fetch_one(self.pool())
        .await?;
        let unique_artist_count = sqlx::query(
            "SELECT COUNT(DISTINCT creators.creator_key) AS unique_artist_count
             FROM listening_sessions sessions
             JOIN analytics_track_creators creators
               ON creators.track_uri = sessions.track_uri
             WHERE sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
               AND sessions.qualified_play <> 0",
        )
        .bind(range.from_unix_ms)
        .bind(range.to_unix_ms)
        .fetch_one(self.pool())
        .await?
        .try_get::<i64, _>("unique_artist_count")?;

        let session_count = non_negative(totals.try_get("session_count")?);
        let effective_session_count = non_negative(totals.try_get("effective_session_count")?);
        let total_listening_ms = non_negative(totals.try_get("total_listening_ms")?);
        let qualified_play_count = non_negative(totals.try_get("qualified_play_count")?);
        let completed_play_count = non_negative(totals.try_get("completed_play_count")?);
        let qualified_listening_ms = non_negative(totals.try_get("qualified_listening_ms")?);
        let behavior = ListeningBehavior {
            average_session_ms: total_listening_ms
                .checked_div(effective_session_count)
                .unwrap_or_default(),
            average_play_ms: qualified_listening_ms
                .checked_div(qualified_play_count)
                .unwrap_or_default(),
            longest_session_ms: non_negative(totals.try_get("longest_session_ms")?),
            skip_count: non_negative(totals.try_get("skip_count")?),
            seek_count: non_negative(totals.try_get("seek_count")?),
            pause_count: non_negative(totals.try_get("pause_count")?),
            repeat_count: non_negative(totals.try_get("repeat_count")?),
            active_day_count: non_negative(totals.try_get("active_day_count")?),
            completion_rate: if qualified_play_count == 0 {
                0.0
            } else {
                completed_play_count as f64 / qualified_play_count as f64
            },
        };

        Ok(ListeningOverview {
            from_unix_ms: range.from_unix_ms,
            to_unix_ms: range.to_unix_ms,
            total_listening_ms,
            session_count,
            qualified_play_count,
            completed_play_count,
            unique_track_count: non_negative(totals.try_get("unique_track_count")?),
            unique_artist_count: non_negative(unique_artist_count),
            unique_playlist_count: non_negative(totals.try_get("unique_playlist_count")?),
            top_tracks: self.top_tracks(range).await?,
            top_artists: self.top_artists(range).await?,
            top_playlists: self.top_playlists(range).await?,
            daily_activity: self.daily_activity(range).await?,
            hourly_activity: self.hourly_activity(range).await?,
            behavior,
        })
    }

    /// Removes both the detailed analytics and the legacy playlist counter so
    /// a user-facing analytics reset has one unsurprising meaning.
    pub async fn clear_listening_analytics(&self) -> Result<(), DatabaseError> {
        let mut transaction = self.pool().begin().await?;
        sqlx::query("DELETE FROM listening_sessions")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM analytics_tracks")
            .execute(&mut *transaction)
            .await?;
        sqlx::query("DELETE FROM playlist_usage")
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(())
    }

    async fn top_tracks(
        &self,
        range: NormalizedRange,
    ) -> Result<Vec<TrackListeningStat>, DatabaseError> {
        let rows = sqlx::query(&format!(
            "WITH normalized_sessions AS (
                SELECT
                    sessions.*,
                    {plays} AS inferred_play_count,
                    {completed} AS inferred_completed_count
                FROM listening_sessions sessions
                JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
                WHERE sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
                  AND sessions.qualified_play <> 0
             ),
             ranked AS (
                SELECT
                    tracks.track_uri,
                    tracks.item_type,
                    tracks.title,
                    tracks.album_uri,
                    tracks.album_name,
                    tracks.duration_ms,
                    tracks.cover_uri,
                    SUM(sessions.listened_ms) AS listening_ms,
                    COUNT(*) AS session_count,
                    SUM(sessions.inferred_play_count) AS play_count,
                    SUM(sessions.inferred_completed_count) AS completed_count,
                    MAX(sessions.started_at_ms) AS last_played_at_ms
                FROM normalized_sessions sessions
                JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
                GROUP BY tracks.track_uri
                ORDER BY listening_ms DESC, play_count DESC, last_played_at_ms DESC
                LIMIT ?
             )
             SELECT
                ranked.track_uri,
                ranked.item_type,
                ranked.title,
                ranked.album_uri,
                ranked.album_name,
                ranked.duration_ms,
                ranked.cover_uri,
                ranked.listening_ms,
                ranked.session_count,
                ranked.play_count,
                ranked.completed_count,
                ranked.last_played_at_ms,
                creators.creator_name,
                creators.creator_uri
             FROM ranked
             LEFT JOIN analytics_track_creators creators
               ON creators.track_uri = ranked.track_uri
             ORDER BY
                ranked.listening_ms DESC,
                ranked.play_count DESC,
                ranked.last_played_at_ms DESC,
                ranked.track_uri ASC,
                creators.ordinal ASC",
            plays = play_count::inferred_play_count(),
            completed = play_count::inferred_completed_count(),
        ))
        .bind(range.from_unix_ms)
        .bind(range.to_unix_ms)
        .bind(range.limit)
        .fetch_all(self.pool())
        .await?;
        Ok(fold_ranked_tracks(rows)?)
    }

    async fn top_artists(
        &self,
        range: NormalizedRange,
    ) -> Result<Vec<ArtistListeningStat>, DatabaseError> {
        let rows = sqlx::query(&format!(
            "WITH normalized_sessions AS (
                SELECT
                    sessions.*,
                    {plays} AS inferred_play_count,
                    {completed} AS inferred_completed_count
                FROM listening_sessions sessions
                JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
                WHERE sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
                  AND sessions.qualified_play <> 0
             )
             SELECT
                creators.creator_key,
                MAX(creators.creator_uri) AS creator_uri,
                MAX(creators.creator_name) AS creator_name,
                SUM(sessions.listened_ms) AS listening_ms,
                COUNT(*) AS session_count,
                SUM(sessions.inferred_play_count) AS play_count,
                SUM(sessions.inferred_completed_count) AS completed_count,
                MAX(sessions.started_at_ms) AS last_played_at_ms
             FROM normalized_sessions sessions
             JOIN analytics_track_creators creators
               ON creators.track_uri = sessions.track_uri
             GROUP BY creators.creator_key
             ORDER BY listening_ms DESC, play_count DESC, last_played_at_ms DESC
             LIMIT ?",
            plays = play_count::inferred_play_count(),
            completed = play_count::inferred_completed_count(),
        ))
        .bind(range.from_unix_ms)
        .bind(range.to_unix_ms)
        .bind(range.limit)
        .fetch_all(self.pool())
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(ArtistListeningStat {
                    creator: Creator {
                        name: row.try_get("creator_name")?,
                        uri: row.try_get("creator_uri")?,
                    },
                    listening_ms: non_negative(row.try_get("listening_ms")?),
                    session_count: non_negative(row.try_get("session_count")?),
                    play_count: non_negative(row.try_get("play_count")?),
                    completed_count: non_negative(row.try_get("completed_count")?),
                    last_played_at_ms: row.try_get("last_played_at_ms")?,
                })
            })
            .collect()
    }

    async fn top_playlists(
        &self,
        range: NormalizedRange,
    ) -> Result<Vec<PlaylistListeningStat>, DatabaseError> {
        let rows = sqlx::query(&format!(
            "WITH normalized_sessions AS (
                SELECT
                    sessions.*,
                    {plays} AS inferred_play_count,
                    {completed} AS inferred_completed_count
                FROM listening_sessions sessions
                JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
                WHERE sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
                  AND sessions.qualified_play <> 0
             )
             SELECT
                context_uri AS playlist_uri,
                MAX(context_name) AS playlist_name,
                SUM(listened_ms) AS listening_ms,
                COUNT(*) AS session_count,
                SUM(inferred_play_count) AS play_count,
                SUM(inferred_completed_count) AS completed_count,
                MAX(started_at_ms) AS last_played_at_ms
             FROM normalized_sessions
             WHERE context_uri IS NOT NULL
               AND (
                    context_type = 'playlist'
                    OR context_uri LIKE 'spotify:playlist:%'
               )
             GROUP BY context_uri
             ORDER BY listening_ms DESC, play_count DESC, last_played_at_ms DESC
             LIMIT ?",
            plays = play_count::inferred_play_count(),
            completed = play_count::inferred_completed_count(),
        ))
        .bind(range.from_unix_ms)
        .bind(range.to_unix_ms)
        .bind(range.limit)
        .fetch_all(self.pool())
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(PlaylistListeningStat {
                    playlist_uri: row.try_get("playlist_uri")?,
                    playlist_name: row.try_get("playlist_name")?,
                    listening_ms: non_negative(row.try_get("listening_ms")?),
                    session_count: non_negative(row.try_get("session_count")?),
                    play_count: non_negative(row.try_get("play_count")?),
                    completed_count: non_negative(row.try_get("completed_count")?),
                    last_played_at_ms: row.try_get("last_played_at_ms")?,
                })
            })
            .collect()
    }

    async fn daily_activity(
        &self,
        range: NormalizedRange,
    ) -> Result<Vec<DailyListeningActivity>, DatabaseError> {
        // Sessions are attributed to the local calendar day of `started_at_ms`.
        // A listen that crosses midnight is not split: the stored session has
        // one start timestamp and no per-day slices, so a later exact split
        // cannot be reconstructed from existing rows.
        let rows = sqlx::query(&format!(
            "WITH normalized_sessions AS (
                SELECT
                    sessions.*,
                    {plays} AS inferred_play_count
                FROM listening_sessions sessions
                LEFT JOIN analytics_tracks tracks
                  ON tracks.track_uri = sessions.track_uri
                WHERE sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
             )
             SELECT
                (
                    ((started_at_ms + ?) / ?) * ?
                ) - ? AS day_start_ms,
                SUM(listened_ms) AS listening_ms,
                COUNT(*) AS session_count,
                SUM(inferred_play_count) AS play_count
             FROM normalized_sessions
             GROUP BY day_start_ms
             ORDER BY day_start_ms ASC",
            plays = play_count::inferred_play_count(),
        ))
        .bind(range.from_unix_ms)
        .bind(range.to_unix_ms)
        .bind(range.timezone_offset_ms)
        .bind(MILLIS_PER_DAY)
        .bind(MILLIS_PER_DAY)
        .bind(range.timezone_offset_ms)
        .fetch_all(self.pool())
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(DailyListeningActivity {
                    day_start_ms: row.try_get("day_start_ms")?,
                    listening_ms: non_negative(row.try_get("listening_ms")?),
                    session_count: non_negative(row.try_get("session_count")?),
                    play_count: non_negative(row.try_get("play_count")?),
                })
            })
            .collect()
    }

    /// When the listener listens: sessions by the local hour they started in.
    async fn hourly_activity(
        &self,
        range: NormalizedRange,
    ) -> Result<Vec<HourlyListeningActivity>, DatabaseError> {
        let rows = sqlx::query(&format!(
            "SELECT
                ((sessions.started_at_ms + ?) % ?) / ? AS hour,
                SUM(sessions.listened_ms) AS listening_ms,
                SUM({plays}) AS play_count
             FROM listening_sessions sessions
             LEFT JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
             WHERE sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
             GROUP BY hour
             ORDER BY hour ASC",
            plays = play_count::inferred_play_count(),
        ))
        .bind(range.timezone_offset_ms)
        .bind(MILLIS_PER_DAY)
        .bind(MILLIS_PER_HOUR)
        .bind(range.from_unix_ms)
        .bind(range.to_unix_ms)
        .fetch_all(self.pool())
        .await?;
        rows.into_iter()
            .map(|row| {
                let hour: i64 = row.try_get("hour")?;
                Ok(HourlyListeningActivity {
                    hour: u8::try_from(hour.rem_euclid(24)).unwrap_or_default(),
                    listening_ms: non_negative(row.try_get("listening_ms")?),
                    play_count: non_negative(row.try_get("play_count")?),
                })
            })
            .collect()
    }
}

fn fold_ranked_tracks(
    rows: Vec<sqlx::sqlite::SqliteRow>,
) -> Result<Vec<TrackListeningStat>, DatabaseError> {
    let mut result = Vec::<TrackListeningStat>::new();
    let mut index_by_uri = HashMap::<String, usize>::new();
    for row in rows {
        let track_uri: String = row.try_get("track_uri")?;
        if let Some(&index) = index_by_uri.get(&track_uri) {
            if let Some(name) = optional_non_empty(row.try_get("creator_name")?) {
                result[index].track.creators.push(Creator {
                    name,
                    uri: row.try_get("creator_uri")?,
                });
            }
            continue;
        }
        index_by_uri.insert(track_uri.clone(), result.len());
        let creators = match optional_non_empty(row.try_get("creator_name")?) {
            Some(name) => vec![Creator {
                name,
                uri: row.try_get("creator_uri")?,
            }],
            None => Vec::new(),
        };
        result.push(TrackListeningStat {
            track: TrackSnapshot {
                uri: track_uri,
                item_type: row.try_get("item_type")?,
                title: row.try_get("title")?,
                album_uri: row.try_get("album_uri")?,
                album_name: row.try_get("album_name")?,
                duration_ms: optional_non_negative(row.try_get("duration_ms")?),
                cover_uri: row.try_get("cover_uri")?,
                creators,
            },
            listening_ms: non_negative(row.try_get("listening_ms")?),
            session_count: non_negative(row.try_get("session_count")?),
            play_count: non_negative(row.try_get("play_count")?),
            completed_count: non_negative(row.try_get("completed_count")?),
            last_played_at_ms: row.try_get("last_played_at_ms")?,
        });
    }
    Ok(result)
}

fn optional_non_empty(value: Option<String>) -> Option<String> {
    value.and_then(|value| non_empty(&value).map(str::to_owned))
}

async fn upsert_track_snapshot(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    track: &TrackSnapshot,
    now: i64,
) -> Result<(), DatabaseError> {
    let title_is_ready = !track.has_placeholder_title();
    sqlx::query(
        "INSERT INTO analytics_tracks(
            track_uri, item_type, title, album_uri, album_name, duration_ms, cover_uri,
            last_seen_at_ms
         ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(track_uri) DO UPDATE SET
            item_type = CASE
                WHEN excluded.item_type <> '' THEN excluded.item_type
                ELSE analytics_tracks.item_type
            END,
            title = CASE
                WHEN ? THEN excluded.title
                WHEN analytics_tracks.title = '' THEN excluded.title
                ELSE analytics_tracks.title
            END,
            album_uri = COALESCE(excluded.album_uri, analytics_tracks.album_uri),
            album_name = COALESCE(excluded.album_name, analytics_tracks.album_name),
            duration_ms = COALESCE(excluded.duration_ms, analytics_tracks.duration_ms),
            cover_uri = COALESCE(excluded.cover_uri, analytics_tracks.cover_uri),
            last_seen_at_ms = MAX(
                analytics_tracks.last_seen_at_ms,
                excluded.last_seen_at_ms
            )",
    )
    .bind(&track.uri)
    .bind(normalized_label(&track.item_type, "track"))
    .bind(track.title.trim())
    .bind(trimmed_option(track.album_uri.as_deref()))
    .bind(trimmed_option(track.album_name.as_deref()))
    .bind(track.duration_ms.map(saturating_i64))
    .bind(trimmed_option(track.cover_uri.as_deref()))
    .bind(now)
    .bind(title_is_ready)
    .execute(&mut **transaction)
    .await?;

    if !track.creators.is_empty() {
        sqlx::query("DELETE FROM analytics_track_creators WHERE track_uri = ?")
            .bind(&track.uri)
            .execute(&mut **transaction)
            .await?;
        let mut creator_keys = HashSet::new();
        for (ordinal, creator) in track.creators.iter().enumerate() {
            let Some(creator_name) = non_empty(creator.name.as_str()) else {
                continue;
            };
            let creator_uri = trimmed_option(creator.uri.as_deref());
            let creator_key = creator_key(creator_uri, creator_name);
            if !creator_keys.insert(creator_key.clone()) {
                continue;
            }
            sqlx::query(
                "INSERT INTO analytics_track_creators(
                    track_uri, creator_key, creator_uri, creator_name, ordinal
                 ) VALUES(?, ?, ?, ?, ?)",
            )
            .bind(&track.uri)
            .bind(creator_key)
            .bind(creator_uri)
            .bind(creator_name)
            .bind(i64::try_from(ordinal).unwrap_or(i64::MAX))
            .execute(&mut **transaction)
            .await?;
        }
    }
    Ok(())
}

fn validate_record(record: &ListeningSessionRecord) -> Result<(), DatabaseError> {
    if record.id.trim().is_empty() || record.id.chars().count() > 128 {
        return Err(DatabaseError::InvalidAnalytics(
            "listening session id is invalid",
        ));
    }
    validate_track_snapshot(&record.track)?;
    if record.started_at_ms < 0
        || record
            .ended_at_ms
            .is_some_and(|ended_at_ms| ended_at_ms < record.started_at_ms)
    {
        return Err(DatabaseError::InvalidAnalytics(
            "listening session timestamps are invalid",
        ));
    }
    if record.completed && !record.qualified_play {
        return Err(DatabaseError::InvalidAnalytics(
            "a completed play must also be qualified",
        ));
    }
    Ok(())
}

fn validate_track_snapshot(track: &TrackSnapshot) -> Result<(), DatabaseError> {
    if track.uri.trim().is_empty() || track.uri.chars().count() > 512 {
        return Err(DatabaseError::InvalidAnalytics("track URI is invalid"));
    }
    if track.title.trim().is_empty() || track.title.chars().count() > 1_024 {
        return Err(DatabaseError::InvalidAnalytics("track title is invalid"));
    }
    if track.creators.iter().any(|creator| {
        creator.name.chars().count() > 512
            || creator
                .uri
                .as_ref()
                .is_some_and(|uri| uri.chars().count() > 512)
    }) {
        return Err(DatabaseError::InvalidAnalytics(
            "track creator metadata is invalid",
        ));
    }
    Ok(())
}

fn is_placeholder_track_title(title: &str, uri: &str) -> bool {
    let title = title.trim();
    let uri_tail = uri.rsplit(':').next().unwrap_or(uri);
    title.is_empty()
        || title == "Titel wird geladen…"
        || title == "Titel wird geladen..."
        || title == "Unbekannter Titel"
        || title == uri
        || title == uri_tail
        || looks_like_spotify_id(title)
}

/// Base62 IDs mix digits and both cases; single-word 22-letter titles are real.
fn looks_like_spotify_id(value: &str) -> bool {
    value.len() == 22
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
        && value.bytes().any(|byte| byte.is_ascii_digit())
        && value.bytes().any(|byte| byte.is_ascii_uppercase())
        && value.bytes().any(|byte| byte.is_ascii_lowercase())
}

fn normalized_label<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    non_empty(value).unwrap_or(fallback)
}

fn trimmed_option(value: Option<&str>) -> Option<&str> {
    value.and_then(non_empty)
}

fn non_empty(value: &str) -> Option<&str> {
    let value = value.trim();
    (!value.is_empty()).then_some(value)
}

fn creator_key(uri: Option<&str>, name: &str) -> String {
    uri.map_or_else(
        || format!("name:{}", name.trim().to_lowercase()),
        ToOwned::to_owned,
    )
}

fn saturating_i64(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

fn non_negative(value: i64) -> u64 {
    u64::try_from(value.max(0)).unwrap_or_default()
}

fn optional_non_negative(value: Option<i64>) -> Option<u64> {
    value.map(non_negative)
}

#[cfg(test)]
mod tests;
