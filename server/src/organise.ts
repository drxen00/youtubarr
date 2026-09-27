/** Organisers that set up one user's series for a channel: playlists, title detection, seeds, or copying a friend's. */
import { db, transaction } from './db.js'
import { fetchChannelPlaylists, playlistVideoIds } from './youtube.js'
import { applyRules, findSeedFor, importSeed } from './series.js'
import { suggestSeries, type Suggestion } from './detect.js'

const AUTO_MIN_COUNT = 5

export function markOrganised(userId: number, channelId: string) {
  db.prepare(
    `INSERT INTO user_channels (user_id, channel_id, organised) VALUES (?, ?, 1)
     ON CONFLICT(user_id, channel_id) DO UPDATE SET organised = 1`,
  ).run(userId, channelId)
}

export function isOrganised(userId: number, channelId: string): boolean {
  return !!db.prepare('SELECT 1 FROM user_channels WHERE user_id = ? AND channel_id = ? AND organised = 1').get(userId, channelId)
}

/**
 * Turns each of the channel's playlists into a series and pins its videos. Playlist picks beat rules
 * (the creator curated them) but lose to manual overrides. Playlists holding fewer than two of this
 * channel's indexed videos are skipped — those are usually "favourites" of other people's stuff.
 */
export async function importPlaylists(apiKey: string, channelId: string, userId: number): Promise<{ playlists: number; assigned: number; skipped: number }> {
  const playlists = await fetchChannelPlaylists(apiKey, channelId)
  const known = new Set((db.prepare('SELECT id FROM videos WHERE channel_id = ?').all(channelId) as { id: string }[]).map((r) => r.id))
  const upsertSeries = db.prepare(
    `INSERT INTO series (user_id, channel_id, name, source, playlist_id) VALUES (?, ?, ?, 'playlist', ?)
     ON CONFLICT(user_id, channel_id, name) DO UPDATE SET playlist_id = COALESCE(series.playlist_id, excluded.playlist_id)
     RETURNING id`,
  )
  const assign = db.prepare(
    `INSERT INTO video_series (user_id, video_id, series_id, source) VALUES (?, ?, ?, 'playlist')
     ON CONFLICT(user_id, video_id) DO UPDATE SET series_id = excluded.series_id, source = 'playlist' WHERE video_series.source != 'manual'`,
  )
  let count = 0
  let assigned = 0
  let skipped = 0
  for (const p of playlists) {
    if (p.itemCount === 0) continue
    const ids: string[] = []
    for await (const page of playlistVideoIds(apiKey, p.id)) ids.push(...page.filter((id) => known.has(id)))
    if (ids.length < 2) {
      skipped++
      continue
    }
    transaction(() => {
      const { id } = upsertSeries.get(userId, channelId, p.title.trim(), p.id) as { id: number }
      for (const vid of ids) assigned += assign.run(userId, vid, id).changes as number
    })
    count++
  }
  markOrganised(userId, channelId)
  return { playlists: count, assigned, skipped }
}

export function suggestForChannel(channelId: string, userId: number, minCount: number): Suggestion[] {
  const ch = db.prepare('SELECT title, handle FROM channels WHERE id = ?').get(channelId) as { title: string; handle: string | null } | undefined
  // Only videos this user hasn't sorted yet — suggestions are for the leftovers.
  const rows = db
    .prepare(
      `SELECT v.id, v.title FROM videos v
       LEFT JOIN video_series vs ON vs.video_id = v.id AND vs.user_id = ?
       WHERE v.channel_id = ? AND v.unavailable = 0 AND vs.video_id IS NULL`,
    )
    .all(userId, channelId) as { id: string; title: string }[]
  const exclude = [ch?.title ?? '', (ch?.handle ?? '').replace(/^@/, '')]
  return suggestSeries(rows, { minCount, exclude })
}

/** Creates series + rules from suggestions, then lets the rules engine assign videos. */
export function createFromSuggestions(channelId: string, userId: number, picks: { name: string; pattern: string }[]): number {
  const insertSeries = db.prepare(
    `INSERT INTO series (user_id, channel_id, name, source, priority) VALUES (?, ?, ?, 'detected', 0)
     ON CONFLICT(user_id, channel_id, name) DO UPDATE SET name = excluded.name RETURNING id`,
  )
  const insertRule = db.prepare('INSERT INTO series_rules (series_id, pattern, flags) VALUES (?, ?, ?)')
  const hasRule = db.prepare('SELECT 1 FROM series_rules WHERE series_id = ? AND pattern = ?')
  let n = 0
  transaction(() => {
    for (const p of picks) {
      try {
        new RegExp(p.pattern, 'i')
      } catch {
        continue
      }
      const { id } = insertSeries.get(userId, channelId, p.name.trim()) as { id: number }
      if (!hasRule.get(id, p.pattern)) insertRule.run(id, p.pattern, 'i')
      n++
    }
  })
  applyRules(channelId, userId)
  markOrganised(userId, channelId)
  return n
}

/** Other users who have set up series for this channel, so a newcomer can copy one of them. */
export function otherSetups(channelId: string, userId: number): { user_id: number; username: string; series_count: number; assigned_count: number }[] {
  return db
    .prepare(
      `SELECT u.id AS user_id, u.username, COUNT(DISTINCT s.id) AS series_count, COUNT(vs.video_id) AS assigned_count
       FROM series s JOIN users u ON u.id = s.user_id
       LEFT JOIN video_series vs ON vs.series_id = s.id
       WHERE s.channel_id = ? AND s.user_id != ?
       GROUP BY u.id HAVING series_count > 0 ORDER BY assigned_count DESC`,
    )
    .all(channelId, userId) as { user_id: number; username: string; series_count: number; assigned_count: number }[]
}

/** Clones another user's series, rules and assignments for this channel. Existing same-name series merge. */
export function copySetup(channelId: string, fromUserId: number, toUserId: number): { series: number; rules: number; assigned: number } {
  const src = db
    .prepare('SELECT id, name, color, priority, source, playlist_id FROM series WHERE channel_id = ? AND user_id = ?')
    .all(channelId, fromUserId) as { id: number; name: string; color: string | null; priority: number; source: string; playlist_id: string | null }[]
  const insertSeries = db.prepare(
    `INSERT INTO series (user_id, channel_id, name, color, priority, source, playlist_id) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, channel_id, name) DO UPDATE SET color = COALESCE(series.color, excluded.color) RETURNING id`,
  )
  const rulesOf = db.prepare('SELECT pattern, flags FROM series_rules WHERE series_id = ? AND enabled = 1')
  const hasRule = db.prepare('SELECT 1 FROM series_rules WHERE series_id = ? AND pattern = ?')
  const insertRule = db.prepare('INSERT INTO series_rules (series_id, pattern, flags) VALUES (?, ?, ?)')
  const assignmentsOf = db.prepare('SELECT video_id, source FROM video_series WHERE series_id = ?') // "no series" pins stay personal
  const assign = db.prepare(`INSERT OR IGNORE INTO video_series (user_id, video_id, series_id, source) VALUES (?, ?, ?, ?)`)
  let series = 0
  let rules = 0
  let assigned = 0
  transaction(() => {
    for (const s of src) {
      const { id } = insertSeries.get(toUserId, channelId, s.name, s.color, s.priority, s.source, s.playlist_id) as { id: number }
      series++
      for (const r of rulesOf.all(s.id) as { pattern: string; flags: string }[]) {
        if (hasRule.get(id, r.pattern)) continue
        insertRule.run(id, r.pattern, r.flags)
        rules++
      }
      for (const a of assignmentsOf.all(s.id) as { video_id: string; source: string }[]) {
        assigned += assign.run(toUserId, a.video_id, id, a.source).changes as number
      }
    }
  })
  applyRules(channelId, toUserId)
  markOrganised(toUserId, channelId)
  return { series, rules, assigned }
}

/** First-time setup for a user on a channel: seed if bundled, otherwise playlists + confident title groups. */
export async function autoOrganise(apiKey: string, channelId: string, userId: number): Promise<{ seeded: string | null; playlists: number; detected: number }> {
  const ch = db.prepare('SELECT handle FROM channels WHERE id = ?').get(channelId) as { handle: string | null } | undefined
  const seeded = findSeedFor(channelId, ch?.handle ?? null)
  if (seeded) {
    importSeed(channelId, userId, seeded)
    applyRules(channelId, userId)
    markOrganised(userId, channelId)
    return { seeded, playlists: 0, detected: 0 }
  }
  const pl = await importPlaylists(apiKey, channelId, userId)
  const detected = createFromSuggestions(channelId, userId, suggestForChannel(channelId, userId, AUTO_MIN_COUNT))
  return { seeded: null, playlists: pl.playlists, detected }
}
