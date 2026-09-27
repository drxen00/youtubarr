import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { config } from './config.js'

export type Row = Record<string, unknown>

export const db = new DatabaseSync(path.join(config.dataDir, 'youtubarr.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

const migrations: string[] = [
  `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channels (
    id                  TEXT PRIMARY KEY,
    title               TEXT NOT NULL,
    handle              TEXT,
    description         TEXT NOT NULL DEFAULT '',
    thumbnail_url       TEXT,
    banner_url          TEXT,
    uploads_playlist_id TEXT NOT NULL,
    video_count         INTEGER NOT NULL DEFAULT 0,
    subscriber_count    INTEGER,
    last_synced_at      TEXT,
    added_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS series (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    color       TEXT,
    priority    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (channel_id, name)
  );

  CREATE TABLE IF NOT EXISTS series_rules (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    series_id INTEGER NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    pattern   TEXT NOT NULL,
    flags     TEXT NOT NULL DEFAULT 'i',
    enabled   INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS videos (
    id               TEXT PRIMARY KEY,
    channel_id       TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    description      TEXT NOT NULL DEFAULT '',
    published_at     TEXT NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    thumbnail_url    TEXT,
    view_count       INTEGER,
    like_count       INTEGER,
    series_id        INTEGER REFERENCES series(id) ON DELETE SET NULL,
    series_manual    INTEGER NOT NULL DEFAULT 0,
    unavailable      INTEGER NOT NULL DEFAULT 0,
    indexed_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS videos_channel_date ON videos(channel_id, published_at);
  CREATE INDEX IF NOT EXISTS videos_series_date  ON videos(series_id, published_at);

  CREATE TABLE IF NOT EXISTS watch_progress (
    video_id         TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    position_seconds REAL NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0,
    completed        INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS downloads (
    video_id   TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
    status     TEXT NOT NULL DEFAULT 'queued',  -- queued | downloading | done | error
    progress   REAL NOT NULL DEFAULT 0,
    file_path  TEXT,
    error      TEXT,
    size_bytes INTEGER,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
]

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id),
  )
  migrations.forEach((sql, i) => {
    const id = i + 1
    if (applied.has(id)) return
    db.exec('BEGIN')
    try {
      db.exec(sql)
      db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(id, new Date().toISOString())
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  })
}
migrate()

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string | null) {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key)
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
}

export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
