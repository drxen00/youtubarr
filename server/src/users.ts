import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db, transaction } from './db.js'
import { config } from './config.js'

export type Role = 'admin' | 'user'
export interface User {
  id: number
  username: string
  role: Role
  created_at: string
  last_login_at: string | null
}

const SESSION_DAYS = 365
const USERNAME_RE = /^[a-z0-9_.-]{2,32}$/i

// ---- passwords ----------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex')
  return `scrypt:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const got = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 })
  const want = Buffer.from(hash, 'hex')
  return got.length === want.length && timingSafeEqual(got, want)
}

export function validUsername(u: string) {
  return USERNAME_RE.test(u)
}
export function validPassword(p: string) {
  return typeof p === 'string' && p.length >= 8 && p.length <= 200
}

// ---- users --------------------------------------------------------------------

const PUBLIC_COLS = 'id, username, role, created_at, last_login_at'

export function listUsers(): User[] {
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM users ORDER BY id`).all() as unknown as User[]
}

export function getUser(id: number): User | undefined {
  return db.prepare(`SELECT ${PUBLIC_COLS} FROM users WHERE id = ?`).get(id) as unknown as User | undefined
}

export function userCount(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n
}

export function createUser(username: string, password: string, role: Role): User {
  const row = db
    .prepare(`INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING ${PUBLIC_COLS}`)
    .get(username.trim(), hashPassword(password), role) as unknown as User
  return row
}

export function setPassword(id: number, password: string) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id) // log out everywhere
}

export function setRole(id: number, role: Role) {
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id)
}

export function deleteUser(id: number) {
  db.prepare('DELETE FROM users WHERE id = ?').run(id)
}

export function adminCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get() as { n: number }).n
}

/** Checks credentials; returns the user or null. */
export function authenticate(username: string, password: string): User | null {
  const row = db.prepare(`SELECT ${PUBLIC_COLS}, password_hash FROM users WHERE username = ?`).get(username.trim()) as
    | (User & { password_hash: string })
    | undefined
  // Always burn the hash cost so username enumeration by timing is harder.
  const ok = verifyPassword(password, row?.password_hash ?? 'scrypt:00:00')
  if (!row || !ok) return null
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date().toISOString(), row.id)
  const { password_hash: _drop, ...user } = row
  return user
}

// ---- sessions -----------------------------------------------------------------

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(userId: number, userAgent: string | undefined): string {
  const token = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString()
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, user_agent) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, expires, userAgent ?? null)
  return token
}

export function userForSession(token: string | undefined): User | null {
  if (!token) return null
  const row = db
    .prepare(`SELECT u.id, u.username, u.role, u.created_at, u.last_login_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`)
    .get(hashToken(token)) as (User & { expires_at: string }) | undefined
  if (!row) return null
  if (row.expires_at < new Date().toISOString()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
    return null
  }
  const { expires_at: _drop, ...user } = row
  return user
}

export function destroySession(token: string | undefined) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

export function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString())
}

// ---- bootstrap ----------------------------------------------------------------

/** Hands pre-multi-user data (watch history, series, assignments) to the given user. */
function adoptLegacyProgress(userId: number) {
  transaction(() => {
    const legacy = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'watch_progress_legacy'`).get()
    if (legacy) {
      db.prepare(
        `INSERT OR IGNORE INTO watch_progress (user_id, video_id, position_seconds, duration_seconds, completed, updated_at)
         SELECT ?, video_id, position_seconds, duration_seconds, completed, updated_at FROM watch_progress_legacy`,
      ).run(userId)
      db.exec('DROP TABLE watch_progress_legacy')
    }
    // Series created before per-user series (migration 4 leaves them with user_id NULL).
    const orphaned = (db.prepare('SELECT COUNT(*) AS n FROM series WHERE user_id IS NULL').get() as { n: number }).n
    if (orphaned) {
      db.prepare('UPDATE series SET user_id = ? WHERE user_id IS NULL').run(userId)
      db.prepare('UPDATE video_series SET user_id = ? WHERE user_id IS NULL').run(userId)
      db.prepare(
        `INSERT OR IGNORE INTO user_channels (user_id, channel_id, organised) SELECT DISTINCT ?, channel_id, 1 FROM series WHERE user_id = ?`,
      ).run(userId, userId)
    }
  })
}

/**
 * Runs at startup. If there are no users yet and APP_PASSWORD is set, that becomes the `admin` account
 * (so existing installs keep working with the same password). Otherwise the UI shows the setup page.
 */
export function bootstrapUsers(log: (msg: string) => void) {
  if (userCount() === 0 && config.appPassword) {
    if (!validPassword(config.appPassword)) log('APP_PASSWORD is shorter than 8 characters; refusing to create the admin account from it. Use the setup page.')
    else {
      const admin = createUser('admin', config.appPassword, 'admin')
      log(`Created admin account "admin" from APP_PASSWORD. You can now remove that variable.`)
      adoptLegacyProgress(admin.id)
    }
  }
  const firstAdmin = db.prepare(`SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1`).get() as { id: number } | undefined
  if (firstAdmin) adoptLegacyProgress(firstAdmin.id)
  purgeExpiredSessions()
}

export function setupRequired() {
  return userCount() === 0
}

/** First-run: creates the initial admin. Only valid while there are no users. */
export function completeSetup(username: string, password: string): User {
  const admin = createUser(username, password, 'admin')
  adoptLegacyProgress(admin.id)
  return admin
}
