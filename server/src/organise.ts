/** Automatic organisers: the creator's own playlists, and title-pattern detection. */
import { db, transaction } from './db.js'
import { fetchChannelPlaylists, playlistVideoIds } from './youtube.js'
import { applyRules } from './series.js'
import { suggestSeries, type Suggestion } from './detect.js'

const AUTO_MIN_COUNT = 5

/**
 * Turns each of the channel's playlists into a series and pins its videos to it. Playlist picks beat
 * rules (the creator curated them) but lose to manual overrides. Playlists that contain fewer than two
 * of this channel's indexed videos are skipped — those are usually "favourites" of other people's stuff.
 */
export async function importPlaylists(apiKey: string, channelId: string): Promise<{ playlists: number; assigned: number; skipped: number }> {
  const playlists = await fetchChannelPlaylists(apiKey, channelId)
  const known = new Set((db.prepare('SELECT id FROM videos WHERE channel_id = ?').all(channelId) as { id: string }[]).map((r) => r.id))
  const upsertSeries = db.prepare(
    `INSERT INTO series (channel_id, name, source, playlist_id) VALUES (?, ?, 'playlist', ?)
     ON CONFLICT(channel_id, name) DO UPDATE SET playlist_id = COALESCE(series.playlist_id, excluded.playlist_id)
     RETURNING id`,
  )
  const assign = db.prepare(`UPDATE videos SET series_id = ?, series_source = 'playlist' WHERE id = ? AND (series_source IS NULL OR series_source != 'manual')`)
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
      const { id } = upsertSeries.get(channelId, p.title.trim(), p.id) as { id: number }
      for (const vid of ids) assigned += assign.run(id, vid).changes as number
    })
    count++
  }
  return { playlists: count, assigned, skipped }
}

export function suggestForChannel(channelId: string, minCount: number): Suggestion[] {
  const ch = db.prepare('SELECT title, handle FROM channels WHERE id = ?').get(channelId) as { title: string; handle: string | null } | undefined
  // Only videos nothing else has claimed — suggestions are for the leftovers.
  const rows = db
    .prepare('SELECT id, title FROM videos WHERE channel_id = ? AND unavailable = 0 AND series_id IS NULL')
    .all(channelId) as { id: string; title: string }[]
  const exclude = [ch?.title ?? '', (ch?.handle ?? '').replace(/^@/, '')]
  return suggestSeries(rows, { minCount, exclude })
}

/** Creates series + rules from suggestions, then lets the rules engine assign videos. */
export function createFromSuggestions(channelId: string, picks: { name: string; pattern: string }[]): number {
  const insertSeries = db.prepare(
    `INSERT INTO series (channel_id, name, source, priority) VALUES (?, ?, 'detected', 0)
     ON CONFLICT(channel_id, name) DO UPDATE SET name = excluded.name RETURNING id`,
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
      const { id } = insertSeries.get(channelId, p.name.trim(), ) as { id: number }
      if (!hasRule.get(id, p.pattern)) insertRule.run(id, p.pattern, 'i')
      n++
    }
  })
  applyRules(channelId)
  return n
}

/** First-sync pass for channels without a bundled seed: playlists first, then confident title groups. */
export async function autoOrganise(apiKey: string, channelId: string): Promise<{ playlists: number; detected: number }> {
  const pl = await importPlaylists(apiKey, channelId)
  const detected = createFromSuggestions(channelId, suggestForChannel(channelId, AUTO_MIN_COUNT))
  db.prepare('UPDATE channels SET auto_organised = 1 WHERE id = ?').run(channelId)
  return { playlists: pl.playlists, detected }
}
