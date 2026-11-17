use super::{TrackListeningStat, fold_ranked_tracks};
use crate::database::{Database, DatabaseError};

impl Database {
    /// Reuses account-local sessions. Brief queue clicks do not enter history.
    pub async fn recently_played_tracks(&self) -> Result<Vec<TrackListeningStat>, DatabaseError> {
        let rows = sqlx::query(
            "WITH recent AS (
                SELECT track_uri, MAX(started_at_ms) AS last_played_at_ms,
                    SUM(listened_ms) AS listening_ms, COUNT(*) AS session_count,
                    SUM(qualified_play) AS play_count, SUM(completed) AS completed_count
                FROM listening_sessions
                WHERE listened_ms >= 4000 AND track_uri LIKE 'spotify:track:%'
                GROUP BY track_uri
                ORDER BY last_played_at_ms DESC, track_uri ASC LIMIT 100
             )
             SELECT tracks.*, recent.listening_ms, recent.session_count,
                recent.play_count, recent.completed_count, recent.last_played_at_ms,
                creators.creator_name, creators.creator_uri
             FROM recent JOIN analytics_tracks tracks ON tracks.track_uri = recent.track_uri
             LEFT JOIN analytics_track_creators creators ON creators.track_uri = recent.track_uri
             ORDER BY recent.last_played_at_ms DESC, recent.track_uri ASC, creators.ordinal ASC",
        )
        .fetch_all(self.pool())
        .await?;
        Ok(fold_ranked_tracks(rows)?)
    }
}
