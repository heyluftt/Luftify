//! "Luftify Rückblick": what a week, month, year or special occasion sounded
//! like. Builds on the overview and adds what only a look back tells:
//! discoveries, the song on repeat, the top album and the change against the
//! period before. Counts follow the overview's rules (qualified plays).

use serde::{Deserialize, Serialize};
use sqlx::Row;

use super::{
    AnalyticsRangeRequest, ArtistListeningStat, Creator, DailyListeningActivity, ListeningOverview,
    MILLIS_PER_DAY, TrackSnapshot, fold_ranked_tracks, non_negative,
};
use super::play_count::{inferred_completed_count, inferred_play_count};
use crate::database::{Database, DatabaseError};

/// Top lists in a recap: five on the slides, ten for "play your top songs".
const RECAP_LIST_LIMIT: u32 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapRequest {
    pub from_unix_ms: i64,
    pub to_unix_ms: i64,
    /// The period of the same length right before, for "more than last time".
    pub previous_from_unix_ms: Option<i64>,
    pub timezone_offset_minutes: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapTrackDay {
    pub track: TrackSnapshot,
    pub day_start_ms: i64,
    pub play_count: u64,
}

/// The song heard most among those first heard in the period.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapDiscovery {
    pub track: TrackSnapshot,
    pub play_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecapAlbum {
    pub album_uri: Option<String>,
    pub album_name: String,
    pub cover_uri: Option<String>,
    pub artist_name: Option<String>,
    pub listening_ms: u64,
    pub play_count: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningRecap {
    pub overview: ListeningOverview,
    pub previous_listening_ms: Option<u64>,
    pub previous_play_count: Option<u64>,
    /// Artists and songs first heard in this period.
    pub new_artist_count: u64,
    pub new_track_count: u64,
    pub top_new_artist: Option<ArtistListeningStat>,
    pub top_discovery: Option<RecapDiscovery>,
    /// When the period's top song was heard for the very first time.
    pub top_track_first_heard_ms: Option<i64>,
    /// The one song played most often on a single day.
    pub on_repeat: Option<RecapTrackDay>,
    pub top_album: Option<RecapAlbum>,
    /// First counted play ever; discoveries mean little right after it.
    pub history_started_at_ms: Option<i64>,
}

impl Database {
    pub async fn listening_recap(&self, request: RecapRequest) -> Result<ListeningRecap, DatabaseError> {
        if request.to_unix_ms <= request.from_unix_ms {
            return Err(DatabaseError::InvalidAnalytics("recap range end must be after its start"));
        }
        let overview = self
            .listening_overview(AnalyticsRangeRequest {
                from_unix_ms: Some(request.from_unix_ms),
                to_unix_ms: Some(request.to_unix_ms),
                limit: RECAP_LIST_LIMIT,
                timezone_offset_minutes: request.timezone_offset_minutes,
            })
            .await?;
        let (from, to) = (request.from_unix_ms, request.to_unix_ms);
        let offset = i64::from(request.timezone_offset_minutes.clamp(-14 * 60, 14 * 60)) * 60_000;

        let previous = match request.previous_from_unix_ms.filter(|start| *start < from) {
            Some(start) => Some(self.period_totals(start, from).await?),
            None => None,
        };
        let (new_artist_count, top_new_artist) = self.new_artists(from, to).await?;
        let top_track_first_heard_ms = match overview.top_tracks.first() {
            Some(top) => self.first_heard(&top.track.uri).await?,
            None => None,
        };
        Ok(ListeningRecap {
            overview,
            previous_listening_ms: previous.map(|(ms, _)| ms),
            previous_play_count: previous.map(|(_, plays)| plays),
            new_artist_count,
            new_track_count: self.new_track_count(from, to).await?,
            top_new_artist,
            top_discovery: self.top_discovery(from, to).await?,
            top_track_first_heard_ms,
            on_repeat: self.on_repeat(from, to, offset).await?,
            top_album: self.top_album(from, to).await?,
            history_started_at_ms: self.history_started_at().await?,
        })
    }

    /// Every day with listening, for finding the periods worth a recap.
    pub async fn listening_days(&self, timezone_offset_minutes: i32) -> Result<Vec<DailyListeningActivity>, DatabaseError> {
        let range = AnalyticsRangeRequest {
            from_unix_ms: Some(0),
            to_unix_ms: None,
            limit: 1,
            timezone_offset_minutes,
        }
        .normalized()?;
        self.daily_activity(range).await
    }

    async fn period_totals(&self, from: i64, to: i64) -> Result<(u64, u64), DatabaseError> {
        let row = sqlx::query(&format!(
            "SELECT COALESCE(SUM(sessions.listened_ms), 0) AS listening_ms,
                    COALESCE(SUM({plays}), 0) AS play_count
             FROM listening_sessions sessions
             LEFT JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
             WHERE sessions.started_at_ms >= ? AND sessions.started_at_ms < ?",
            plays = inferred_play_count(),
        ))
        .bind(from)
        .bind(to)
        .fetch_one(self.pool())
        .await?;
        Ok((non_negative(row.try_get("listening_ms")?), non_negative(row.try_get("play_count")?)))
    }

    async fn new_artists(&self, from: i64, to: i64) -> Result<(u64, Option<ArtistListeningStat>), DatabaseError> {
        let rows = sqlx::query(&format!(
            "WITH firsts AS (
                SELECT creators.creator_key, MIN(sessions.started_at_ms) AS first_ms
                FROM listening_sessions sessions
                JOIN analytics_track_creators creators ON creators.track_uri = sessions.track_uri
                WHERE sessions.qualified_play <> 0
                GROUP BY creators.creator_key
             ),
             fresh AS (SELECT creator_key FROM firsts WHERE first_ms >= ? AND first_ms < ?)
             SELECT
                creators.creator_key,
                MAX(creators.creator_name) AS creator_name,
                MAX(creators.creator_uri) AS creator_uri,
                SUM(sessions.listened_ms) AS listening_ms,
                COUNT(*) AS session_count,
                SUM({plays}) AS play_count,
                SUM({completed}) AS completed_count,
                MAX(sessions.started_at_ms) AS last_played_at_ms,
                (SELECT COUNT(*) FROM fresh) AS fresh_count
             FROM listening_sessions sessions
             LEFT JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
             JOIN analytics_track_creators creators ON creators.track_uri = sessions.track_uri
             JOIN fresh ON fresh.creator_key = creators.creator_key
             WHERE sessions.qualified_play <> 0
               AND sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
             GROUP BY creators.creator_key
             ORDER BY listening_ms DESC, play_count DESC
             LIMIT 1",
            plays = inferred_play_count(),
            completed = inferred_completed_count(),
        ))
        .bind(from)
        .bind(to)
        .bind(from)
        .bind(to)
        .fetch_all(self.pool())
        .await?;
        let Some(row) = rows.into_iter().next() else {
            return Ok((0, None));
        };
        let count = non_negative(row.try_get("fresh_count")?);
        let top = ArtistListeningStat {
            creator: Creator {
                name: row.try_get("creator_name")?,
                uri: row.try_get("creator_uri")?,
            },
            listening_ms: non_negative(row.try_get("listening_ms")?),
            session_count: non_negative(row.try_get("session_count")?),
            play_count: non_negative(row.try_get("play_count")?),
            completed_count: non_negative(row.try_get("completed_count")?),
            last_played_at_ms: row.try_get("last_played_at_ms")?,
        };
        Ok((count, Some(top)))
    }

    async fn new_track_count(&self, from: i64, to: i64) -> Result<u64, DatabaseError> {
        let row = sqlx::query(
            "SELECT COUNT(*) AS fresh_count FROM (
                SELECT track_uri, MIN(started_at_ms) AS first_ms
                FROM listening_sessions
                WHERE qualified_play <> 0
                GROUP BY track_uri
             ) WHERE first_ms >= ? AND first_ms < ?",
        )
        .bind(from)
        .bind(to)
        .fetch_one(self.pool())
        .await?;
        Ok(non_negative(row.try_get("fresh_count")?))
    }

    async fn top_discovery(&self, from: i64, to: i64) -> Result<Option<RecapDiscovery>, DatabaseError> {
        let best = sqlx::query(&format!(
            "WITH firsts AS (
                SELECT track_uri, MIN(started_at_ms) AS first_ms
                FROM listening_sessions
                WHERE qualified_play <> 0
                GROUP BY track_uri
             )
             SELECT sessions.track_uri, SUM({plays}) AS play_count, SUM(sessions.listened_ms) AS listening_ms
             FROM listening_sessions sessions
             LEFT JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
             JOIN firsts ON firsts.track_uri = sessions.track_uri
             WHERE sessions.qualified_play <> 0
               AND sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
               AND firsts.first_ms >= ? AND firsts.first_ms < ?
             GROUP BY sessions.track_uri
             ORDER BY listening_ms DESC, play_count DESC
             LIMIT 1",
            plays = inferred_play_count(),
        ))
        .bind(from)
        .bind(to)
        .bind(from)
        .bind(to)
        .fetch_optional(self.pool())
        .await?;
        let Some(best) = best else {
            return Ok(None);
        };
        let uri: String = best.try_get("track_uri")?;
        let play_count = non_negative(best.try_get("play_count")?);
        Ok(self.recap_track(&uri).await?.map(|track| RecapDiscovery { track, play_count }))
    }

    async fn first_heard(&self, uri: &str) -> Result<Option<i64>, DatabaseError> {
        let row = sqlx::query("SELECT MIN(started_at_ms) AS first_ms FROM listening_sessions WHERE track_uri = ? AND qualified_play <> 0")
            .bind(uri)
            .fetch_one(self.pool())
            .await?;
        Ok(row.try_get("first_ms")?)
    }

    async fn on_repeat(&self, from: i64, to: i64, offset: i64) -> Result<Option<RecapTrackDay>, DatabaseError> {
        let best = sqlx::query(&format!(
            "SELECT sessions.track_uri,
                    (((sessions.started_at_ms + ?) / ?) * ?) - ? AS day_start_ms,
                    SUM({plays}) AS play_count,
                    SUM(sessions.listened_ms) AS listening_ms
             FROM listening_sessions sessions
             LEFT JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
             WHERE sessions.qualified_play <> 0 AND sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
             GROUP BY sessions.track_uri, day_start_ms
             ORDER BY play_count DESC, listening_ms DESC
             LIMIT 1",
            plays = inferred_play_count(),
        ))
        .bind(offset)
        .bind(MILLIS_PER_DAY)
        .bind(MILLIS_PER_DAY)
        .bind(offset)
        .bind(from)
        .bind(to)
        .fetch_optional(self.pool())
        .await?;
        let Some(best) = best else {
            return Ok(None);
        };
        let play_count = non_negative(best.try_get("play_count")?);
        // One or two plays of a song on a day is not "on repeat".
        if play_count < 3 {
            return Ok(None);
        }
        let uri: String = best.try_get("track_uri")?;
        let Some(track) = self.recap_track(&uri).await? else {
            return Ok(None);
        };
        Ok(Some(RecapTrackDay {
            track,
            day_start_ms: best.try_get("day_start_ms")?,
            play_count,
        }))
    }

    /// The most played album. Singles do not count: the analytics know no
    /// release type, so an album needs three songs heard, or two when none of
    /// them carries the release's name (singles are named after their song).
    async fn top_album(&self, from: i64, to: i64) -> Result<Option<RecapAlbum>, DatabaseError> {
        let row = sqlx::query(&format!(
            "SELECT tracks.album_uri,
                    MAX(tracks.album_name) AS album_name,
                    MAX(tracks.cover_uri) AS cover_uri,
                    MAX(tracks.track_uri) AS sample_track,
                    SUM(sessions.listened_ms) AS listening_ms,
                    SUM({plays}) AS play_count
             FROM listening_sessions sessions
             JOIN analytics_tracks tracks ON tracks.track_uri = sessions.track_uri
             WHERE sessions.qualified_play <> 0
               AND sessions.started_at_ms >= ? AND sessions.started_at_ms < ?
               AND tracks.album_name IS NOT NULL AND TRIM(tracks.album_name) <> ''
             GROUP BY COALESCE(tracks.album_uri, tracks.album_name)
             HAVING COUNT(DISTINCT tracks.track_uri) >= 3
                 OR (COUNT(DISTINCT tracks.track_uri) = 2
                     AND SUM(CASE WHEN LOWER(TRIM(tracks.title)) = LOWER(TRIM(tracks.album_name)) THEN 1 ELSE 0 END) = 0)
             ORDER BY listening_ms DESC, play_count DESC
             LIMIT 1",
            plays = inferred_play_count(),
        ))
        .bind(from)
        .bind(to)
        .fetch_optional(self.pool())
        .await?;
        let Some(row) = row else {
            return Ok(None);
        };
        let sample: String = row.try_get("sample_track")?;
        let artist_name = sqlx::query(
            "SELECT creator_name FROM analytics_track_creators WHERE track_uri = ? ORDER BY ordinal ASC LIMIT 1",
        )
        .bind(&sample)
        .fetch_optional(self.pool())
        .await?
        .map(|artist| artist.try_get::<String, _>("creator_name"))
        .transpose()?;
        Ok(Some(RecapAlbum {
            album_uri: row.try_get("album_uri")?,
            album_name: row.try_get("album_name")?,
            cover_uri: row.try_get("cover_uri")?,
            artist_name,
            listening_ms: non_negative(row.try_get("listening_ms")?),
            play_count: non_negative(row.try_get("play_count")?),
        }))
    }

    async fn history_started_at(&self) -> Result<Option<i64>, DatabaseError> {
        let row = sqlx::query("SELECT MIN(started_at_ms) AS first_ms FROM listening_sessions WHERE qualified_play <> 0")
            .fetch_one(self.pool())
            .await?;
        Ok(row.try_get("first_ms")?)
    }

    async fn recap_track(&self, uri: &str) -> Result<Option<TrackSnapshot>, DatabaseError> {
        let rows = sqlx::query(
            "SELECT tracks.track_uri, tracks.item_type, tracks.title, tracks.album_uri, tracks.album_name,
                    tracks.duration_ms, tracks.cover_uri,
                    0 AS listening_ms, 0 AS session_count, 0 AS play_count, 0 AS completed_count,
                    0 AS last_played_at_ms,
                    creators.creator_name, creators.creator_uri
             FROM analytics_tracks tracks
             LEFT JOIN analytics_track_creators creators ON creators.track_uri = tracks.track_uri
             WHERE tracks.track_uri = ?
             ORDER BY creators.ordinal ASC",
        )
        .bind(uri)
        .fetch_all(self.pool())
        .await?;
        Ok(fold_ranked_tracks(rows)?.into_iter().next().map(|stat| stat.track))
    }
}
