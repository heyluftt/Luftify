//! How many plays one stored session holds. Normally one, even after seeks.
//! Two kinds hold several: sessions migration 0004 marked as merged repeat-one
//! cycles, and sessions that ran far past the song's length while jumping back
//! (before 29 September 2026 the tracker took a restart from the top for a
//! seek, so a song on repeat stayed one long session). Both are expanded by
//! listened time. Needs `sessions` and `tracks` (analytics_tracks) in scope.

const LEGACY_MERGED: &str = "COALESCE(sessions.end_reason, '') = 'legacy-repeat-merged'";
/// Played on past twice the song's length with jumps back: restarts from the
/// top. Plain rewinds to hear a part again rarely double a song's length.
const RESTARTED: &str = "(sessions.seek_count > 0 AND sessions.listened_ms >= tracks.duration_ms * 2)";
/// Plays that fit into the listened time.
const BY_TIME: &str = "MAX(1, (sessions.listened_ms + tracks.duration_ms - MIN(30000, MAX(1, tracks.duration_ms / 2))) / tracks.duration_ms)";

/// Qualified plays of a session: 0 when it never qualified. A restarted
/// session counts no more plays than it had jumps back, plus one.
pub(super) fn inferred_play_count() -> String {
    format!(
        "CASE
            WHEN sessions.qualified_play = 0 THEN 0
            WHEN tracks.duration_ms IS NULL OR tracks.duration_ms <= 0 THEN 1
            WHEN {LEGACY_MERGED} THEN {BY_TIME}
            WHEN {RESTARTED} THEN MIN(sessions.seek_count + 1, {BY_TIME})
            ELSE 1
        END"
    )
}

/// Plays of a session that ran to the end.
pub(super) fn inferred_completed_count() -> String {
    format!(
        "CASE
            WHEN sessions.qualified_play = 0 THEN 0
            WHEN tracks.duration_ms IS NULL OR tracks.duration_ms <= 0 THEN sessions.completed
            WHEN {LEGACY_MERGED} THEN MAX(sessions.completed, sessions.listened_ms / tracks.duration_ms)
            WHEN {RESTARTED} THEN MAX(sessions.completed, MIN(sessions.seek_count + 1, sessions.listened_ms / tracks.duration_ms))
            ELSE sessions.completed
        END"
    )
}
