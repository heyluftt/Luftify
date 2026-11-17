CREATE TABLE IF NOT EXISTS analytics_tracks (
  track_uri TEXT PRIMARY KEY NOT NULL,
  item_type TEXT NOT NULL,
  title TEXT NOT NULL,
  album_uri TEXT,
  album_name TEXT,
  duration_ms INTEGER CHECK(duration_ms IS NULL OR duration_ms >= 0),
  cover_uri TEXT,
  last_seen_at_ms INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics_track_creators (
  track_uri TEXT NOT NULL
    REFERENCES analytics_tracks(track_uri) ON DELETE CASCADE,
  creator_key TEXT NOT NULL,
  creator_uri TEXT,
  creator_name TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
  PRIMARY KEY(track_uri, creator_key),
  UNIQUE(track_uri, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_analytics_track_creators_key
  ON analytics_track_creators(creator_key);

CREATE TABLE IF NOT EXISTS listening_sessions (
  session_id TEXT PRIMARY KEY NOT NULL,
  track_uri TEXT NOT NULL
    REFERENCES analytics_tracks(track_uri) ON DELETE CASCADE,
  context_uri TEXT,
  context_name TEXT,
  context_type TEXT NOT NULL,
  source TEXT NOT NULL,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  start_position_ms INTEGER CHECK(start_position_ms IS NULL OR start_position_ms >= 0),
  end_position_ms INTEGER CHECK(end_position_ms IS NULL OR end_position_ms >= 0),
  listened_ms INTEGER NOT NULL DEFAULT 0 CHECK(listened_ms >= 0),
  qualified_play INTEGER NOT NULL DEFAULT 0 CHECK(qualified_play IN (0, 1)),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0, 1)),
  seek_count INTEGER NOT NULL DEFAULT 0 CHECK(seek_count >= 0),
  pause_count INTEGER NOT NULL DEFAULT 0 CHECK(pause_count >= 0),
  repeat_cycle INTEGER NOT NULL DEFAULT 0 CHECK(repeat_cycle >= 0),
  end_reason TEXT,
  updated_at_ms INTEGER NOT NULL,
  CHECK(ended_at_ms IS NULL OR ended_at_ms >= started_at_ms)
);

CREATE INDEX IF NOT EXISTS idx_listening_sessions_started
  ON listening_sessions(started_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_listening_sessions_track_started
  ON listening_sessions(track_uri, started_at_ms DESC);

CREATE INDEX IF NOT EXISTS idx_listening_sessions_context_started
  ON listening_sessions(context_uri, started_at_ms DESC);
