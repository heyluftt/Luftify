-- Older trackers could merge many repeat-one cycles into one long session.
-- Migration 0004 already closed rows left open by an earlier process. Limit
-- this repair to extreme qualified outliers from exactly that crash signature;
-- ordinary long or seeked sessions remain a single play when history is unclear.
UPDATE listening_sessions
SET end_reason = 'legacy-repeat-merged'
WHERE qualified_play <> 0
  AND end_reason = 'unclean-shutdown'
  AND ended_at_ms = updated_at_ms
  AND EXISTS (
      SELECT 1
      FROM analytics_tracks tracks
      WHERE tracks.track_uri = listening_sessions.track_uri
        AND tracks.duration_ms IS NOT NULL
        AND tracks.duration_ms > 0
        AND listening_sessions.listened_ms >= tracks.duration_ms * 4
  );
