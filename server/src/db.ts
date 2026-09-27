import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import { config } from './config.js'

export type Row = Record<string, unknown>

export const db = new DatabaseSync(path.join(config.dataDir, 'youtubarr.db'))
db.exec('PRAGMA journal_mode = WAL')
db.exec('PRAGMA foreign_keys = ON')

/** A migration is plain SQL, or a function for the rare table rebuild that needs FK enforcement off. */
type Migration = string | { fkOff: true; sql: string }

const migrations: Migration[] = [
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
  // 2: where a series / an assignment came from, so rule re-runs don't clobber playlist or manual picks.
  `
  ALTER TABLE series ADD COLUMN source TEXT NOT NULL DEFAULT 'rules';   -- rules | playlist | detected | seed
  ALTER TABLE series ADD COLUMN playlist_id TEXT;
  ALTER TABLE videos ADD COLUMN series_source TEXT;                     -- rule | playlist | manual
  UPDATE videos SET series_source = CASE WHEN series_manual = 1 THEN 'manual' WHEN series_id IS NOT NULL THEN 'rule' END;
  ALTER TABLE channels ADD COLUMN auto_organised INTEGER NOT NULL DEFAULT 0;
  `,
  // 3: multi-user. Watch progress becomes per-user; the legacy table is folded into the first admin by bootstrapUsers().
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'user',   -- admin | user
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_login_at TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at TEXT NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  ALTER TABLE watch_progress RENAME TO watch_progress_legacy;
  CREATE TABLE watch_progress (
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_id         TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
    position_seconds REAL NOT NULL DEFAULT 0,
    duration_seconds REAL NOT NULL DEFAULT 0,
    completed        INTEGER NOT NULL DEFAULT 0,
    updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (user_id, video_id)
  );
  CREATE INDEX watch_progress_user_updated ON watch_progress(user_id, updated_at);
  `,
  // 4: series become per-user. The series table is rebuilt (SQLite can't change a UNIQUE constraint), video
  // assignments move to video_series keyed by user, and per-user channel setup state gets its own table.
  // Rows with user_id NULL are pre-multi-user data; bootstrapUsers() hands them to the first admin.
  {
    fkOff: true,
    sql: `
    CREATE TABLE series_new (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
      channel_id  TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      color       TEXT,
      priority    INTEGER NOT NULL DEFAULT 0,
      source      TEXT NOT NULL DEFAULT 'rules',
      playlist_id TEXT,
      created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE (user_id, channel_id, name)
    );
    INSERT INTO series_new (id, user_id, channel_id, name, color, priority, source, playlist_id, created_at)
      SELECT id, NULL, channel_id, name, color, priority, source, playlist_id, created_at FROM series;
    DROP TABLE series;
    ALTER TABLE series_new RENAME TO series;
    CREATE INDEX series_user_channel ON series(user_id, channel_id);

    -- series_id NULL with source 'manual' means "explicitly in no series", so rules leave it alone.
    CREATE TABLE video_series (
      user_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
      video_id  TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
      series_id INTEGER REFERENCES series(id) ON DELETE CASCADE,
      source    TEXT NOT NULL DEFAULT 'rule',   -- rule | playlist | manual
      PRIMARY KEY (user_id, video_id)
    );
    CREATE INDEX video_series_series ON video_series(series_id);
    INSERT INTO video_series (user_id, video_id, series_id, source)
      SELECT NULL, id, series_id, CASE WHEN series_manual = 1 THEN 'manual' ELSE COALESCE(series_source, 'rule') END
      FROM videos WHERE series_id IS NOT NULL OR series_manual = 1;

    DROP INDEX IF EXISTS videos_series_date;
    ALTER TABLE videos DROP COLUMN series_id;
    ALTER TABLE videos DROP COLUMN series_manual;
    ALTER TABLE videos DROP COLUMN series_source;

    CREATE TABLE user_channels (
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
      organised  INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, channel_id)
    );
    ALTER TABLE channels DROP COLUMN auto_organised;
    `,
  },
]

function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(
    (db.prepare('SELECT id FROM _migrations').all() as { id: number }[]).map((r) => r.id),
  )
  migrations.forEach((m, i) => {
    const id = i + 1
    if (applied.has(id)) return
    const fkOff = typeof m !== 'string'
    const sql = typeof m === 'string' ? m : m.sql
    if (fkOff) db.exec('PRAGMA foreign_keys = OFF') // must be outside a transaction
    db.exec('BEGIN')
    try {
      db.exec(sql)
      if (fkOff) {
        const problems = db.prepare('PRAGMA foreign_key_check').all()
        if (problems.length) throw new Error(`migration ${id} left dangling foreign keys: ${JSON.stringify(problems.slice(0, 3))}`)
      }
      db.prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)').run(id, new Date().toISOString())
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    } finally {
      if (fkOff) db.exec('PRAGMA foreign_keys = ON')
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
