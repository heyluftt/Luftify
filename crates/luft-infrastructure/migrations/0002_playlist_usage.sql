CREATE TABLE IF NOT EXISTS playlist_usage (
  playlist_uri TEXT PRIMARY KEY NOT NULL,
  play_count INTEGER NOT NULL DEFAULT 1 CHECK(play_count >= 0),
  last_played_at INTEGER NOT NULL,
  last_track_uri TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_playlist_usage_recent
  ON playlist_usage(last_played_at DESC);

CREATE INDEX IF NOT EXISTS idx_playlist_usage_count
  ON playlist_usage(play_count DESC, last_played_at DESC);
