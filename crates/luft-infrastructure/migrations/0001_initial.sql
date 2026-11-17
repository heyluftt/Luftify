CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS module_state (
  module_id TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_entries (
  cache_key TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_history (
  query TEXT PRIMARY KEY NOT NULL,
  searched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS bridge_compatibility (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  spotify_version TEXT,
  spicetify_version TEXT,
  bridge_version TEXT NOT NULL,
  protocol_version INTEGER NOT NULL,
  capabilities TEXT NOT NULL,
  adapters TEXT NOT NULL,
  last_success_at INTEGER NOT NULL
);

