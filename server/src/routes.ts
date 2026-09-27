import type { FastifyInstance } from 'fastify'
import { config } from './config.js'
import { db, getSetting, setSetting } from './db.js'
import { addChannel, apiKey, syncChannel, syncStatus } from './indexer.js'
import { autoOrganise, createFromSuggestions, importPlaylists, suggestForChannel } from './organise.js'
import { applyRules, findSeedFor, importSeed, listSeeds } from './series.js'
import * as downloads from './downloads.js'
import { requireUser } from './auth.js'
import { YouTubeApiError } from './youtube.js'

type VideoRow = {
  id: string
  channel_id: string
  title: string
  description: string
  published_at: string
  duration_seconds: number
  thumbnail_url: string | null
  view_count: number | null
  like_count: number | null
  series_id: number | null
  series_manual: number
  unavailable: number
}

const VIDEO_COLS = `v.id, v.channel_id, v.title, v.published_at, v.duration_seconds, v.thumbnail_url, v.view_count, v.series_id, v.series_manual, v.unavailable,
  s.name AS series_name, s.color AS series_color,
  p.position_seconds AS progress_position, p.duration_seconds AS progress_duration, p.completed AS progress_completed,
  d.status AS download_status, d.progress AS download_progress`
/** Progress is per user; `userId` is a server-issued integer, so inlining it is safe. */
const joins = (userId: number) => `LEFT JOIN series s ON s.id = v.series_id
  LEFT JOIN watch_progress p ON p.video_id = v.id AND p.user_id = ${Number(userId)}
  LEFT JOIN downloads d ON d.video_id = v.id`

function bad(reply: { code: (n: number) => { send: (b: unknown) => unknown } }, msg: string, code = 400) {
  return reply.code(code).send({ error: msg })
}

export function registerRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }))

  // ---- settings -------------------------------------------------------------
  app.get('/api/settings', async () => ({
    youtubeApiKeySet: !!(getSetting('youtube_api_key') || config.youtubeApiKey),
    youtubeApiKeyFromEnv: !getSetting('youtube_api_key') && !!config.youtubeApiKey,
    ytDlpVersion: downloads.ytDlpAvailable(),
    mediaDir: config.mediaDir,
    dataDir: config.dataDir,
    seeds: listSeeds(),
  }))

  app.put<{ Body: { youtubeApiKey?: string | null } }>('/api/settings', async (req) => {
    if ('youtubeApiKey' in req.body) {
      const v = req.body.youtubeApiKey
      setSetting('youtube_api_key', v ? v.trim() : null)
    }
    return { ok: true }
  })

  // ---- channels -------------------------------------------------------------
  app.get('/api/channels', async () => {
    const rows = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM videos v WHERE v.channel_id = c.id AND v.unavailable = 0) AS indexed_count,
                (SELECT COUNT(*) FROM series s WHERE s.channel_id = c.id) AS series_count
         FROM channels c ORDER BY c.added_at`,
      )
      .all() as Record<string, unknown>[]
    return rows.map((c) => ({ ...c, sync: syncStatus(c.id as string) }))
  })

  app.post<{ Body: { input?: string } }>('/api/channels', async (req, reply) => {
    if (!req.body?.input) return bad(reply, 'input is required')
    try {
      return await addChannel(req.body.input)
    } catch (e) {
      if (e instanceof YouTubeApiError) return bad(reply, e.message, e.status === 404 ? 404 : 400)
      throw e
    }
  })

  app.get<{ Params: { id: string } }>('/api/channels/:id', async (req, reply) => {
    const c = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!c) return bad(reply, 'not found', 404)
    const years = db
      .prepare(`SELECT substr(published_at, 1, 4) AS year, COUNT(*) AS count FROM videos WHERE channel_id = ? AND unavailable = 0 GROUP BY year ORDER BY year`)
      .all(req.params.id)
    return { ...c, sync: syncStatus(req.params.id), years }
  })

  app.delete<{ Params: { id: string } }>('/api/channels/:id', async (req) => {
    db.prepare('DELETE FROM channels WHERE id = ?').run(req.params.id)
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { full?: boolean } }>('/api/channels/:id/sync', async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM channels WHERE id = ?').get(req.params.id)) return bad(reply, 'not found', 404)
    void syncChannel(req.params.id, { full: !!req.body?.full })
    return syncStatus(req.params.id)
  })
  app.get<{ Params: { id: string } }>('/api/channels/:id/sync', async (req) => syncStatus(req.params.id))

  /** Month buckets for the timeline scrubber. */
  app.get<{ Params: { id: string }; Querystring: { series?: string } }>('/api/channels/:id/timeline', async (req) => {
    const where = ['channel_id = ?', 'unavailable = 0']
    const params: unknown[] = [req.params.id]
    if (req.query.series === 'none') where.push('series_id IS NULL')
    else if (req.query.series) {
      where.push('series_id = ?')
      params.push(Number(req.query.series))
    }
    return db
      .prepare(`SELECT substr(published_at, 1, 7) AS month, COUNT(*) AS count FROM videos WHERE ${where.join(' AND ')} GROUP BY month ORDER BY month`)
      .all(...(params as (string | number)[]))
  })

  app.get<{
    Params: { id: string }
    Querystring: { series?: string; q?: string; year?: string; from?: string; to?: string; sort?: string; limit?: string; offset?: string }
  }>('/api/channels/:id/videos', async (req) => {
    const q = req.query
    const where = ['v.channel_id = ?', 'v.unavailable = 0']
    const params: (string | number)[] = [req.params.id]
    if (q.series === 'none') where.push('v.series_id IS NULL')
    else if (q.series) {
      where.push('v.series_id = ?')
      params.push(Number(q.series))
    }
    if (q.q) {
      where.push('v.title LIKE ? ESCAPE \'\\\'')
      params.push(`%${q.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)
    }
    if (q.year) {
      where.push('substr(v.published_at,1,4) = ?')
      params.push(q.year)
    }
    if (q.from) {
      where.push('v.published_at >= ?')
      params.push(q.from)
    }
    if (q.to) {
      where.push('v.published_at < ?')
      params.push(q.to)
    }
    const sort =
      {
        oldest: 'v.published_at ASC',
        views: 'v.view_count DESC',
        longest: 'v.duration_seconds DESC',
        newest: 'v.published_at DESC',
      }[q.sort ?? 'newest'] ?? 'v.published_at DESC'
    const limit = Math.min(Math.max(Number(q.limit) || 60, 1), 500)
    const offset = Math.max(Number(q.offset) || 0, 0)
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM videos v WHERE ${where.join(' AND ')}`).get(...params) as { n: number }).n
    const items = db
      .prepare(`SELECT ${VIDEO_COLS} FROM videos v ${joins(requireUser(req).id)} WHERE ${where.join(' AND ')} ORDER BY ${sort}, v.id LIMIT ? OFFSET ?`)
      .all(...params, limit, offset)
    return { total, limit, offset, items }
  })

  app.get<{ Params: { id: string } }>('/api/channels/:id/continue', async (req) =>
    db
      .prepare(
        `SELECT ${VIDEO_COLS} FROM videos v ${joins(requireUser(req).id)}
         WHERE v.channel_id = ? AND v.unavailable = 0 AND p.completed = 0 AND p.position_seconds > 30
         ORDER BY p.updated_at DESC LIMIT 12`,
      )
      .all(req.params.id),
  )

  // ---- series ---------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/channels/:id/series', async (req) =>
    db
      .prepare(
        `SELECT s.*, COUNT(v.id) AS video_count, MIN(v.published_at) AS first_at, MAX(v.published_at) AS last_at,
                (SELECT thumbnail_url FROM videos WHERE series_id = s.id AND unavailable = 0 ORDER BY published_at LIMIT 1) AS thumbnail_url,
                (SELECT COUNT(*) FROM series_rules r WHERE r.series_id = s.id) AS rule_count,
                (SELECT COUNT(*) FROM videos v2 JOIN watch_progress p ON p.video_id = v2.id AND p.user_id = ? WHERE v2.series_id = s.id AND p.completed = 1) AS watched_count
         FROM series s LEFT JOIN videos v ON v.series_id = s.id AND v.unavailable = 0
         WHERE s.channel_id = ? GROUP BY s.id ORDER BY video_count DESC, s.name`,
      )
      .all(requireUser(req).id, req.params.id),
  )

  app.post<{ Params: { id: string }; Body: { name?: string; color?: string; priority?: number; patterns?: string[] } }>(
    '/api/channels/:id/series',
    async (req, reply) => {
      const name = req.body?.name?.trim()
      if (!name) return bad(reply, 'name is required')
      const row = db
        .prepare('INSERT INTO series (channel_id, name, color, priority) VALUES (?, ?, ?, ?) RETURNING id')
        .get(req.params.id, name, req.body.color ?? null, req.body.priority ?? 0) as { id: number }
      for (const p of req.body.patterns ?? []) {
        if (!validRegex(p)) return bad(reply, `Invalid regex: ${p}`)
        db.prepare('INSERT INTO series_rules (series_id, pattern) VALUES (?, ?)').run(row.id, p)
      }
      applyRules(req.params.id)
      return { id: row.id }
    },
  )

  app.post<{ Params: { id: string } }>('/api/channels/:id/series/apply', async (req) => applyRules(req.params.id))

  // ---- automatic organisers -------------------------------------------------
  app.post<{ Params: { id: string } }>('/api/channels/:id/organise/playlists', async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM channels WHERE id = ?').get(req.params.id)) return bad(reply, 'not found', 404)
    try {
      return await importPlaylists(apiKey(), req.params.id)
    } catch (e) {
      if (e instanceof YouTubeApiError) return bad(reply, e.message)
      throw e
    }
  })
  app.post<{ Params: { id: string } }>('/api/channels/:id/organise/auto', async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM channels WHERE id = ?').get(req.params.id)) return bad(reply, 'not found', 404)
    try {
      return await autoOrganise(apiKey(), req.params.id)
    } catch (e) {
      if (e instanceof YouTubeApiError) return bad(reply, e.message)
      throw e
    }
  })
  app.get<{ Params: { id: string }; Querystring: { min?: string } }>('/api/channels/:id/organise/suggest', async (req) =>
    suggestForChannel(req.params.id, Math.max(2, Number(req.query.min) || 3)),
  )
  app.post<{ Params: { id: string }; Body: { picks?: { name: string; pattern: string }[] } }>('/api/channels/:id/organise/create', async (req, reply) => {
    const picks = req.body?.picks
    if (!Array.isArray(picks) || picks.length === 0) return bad(reply, 'picks required')
    return { created: createFromSuggestions(req.params.id, picks) }
  })

  app.post<{ Params: { id: string }; Body: { file?: string } }>('/api/channels/:id/series/import-seed', async (req, reply) => {
    const c = db.prepare('SELECT handle FROM channels WHERE id = ?').get(req.params.id) as { handle: string | null } | undefined
    if (!c) return bad(reply, 'not found', 404)
    const file = req.body?.file || findSeedFor(req.params.id, c.handle)
    if (!file) return bad(reply, 'No starter ruleset available for this channel')
    const r = importSeed(req.params.id, file)
    return { ...r, ...applyRules(req.params.id) }
  })

  app.get<{ Params: { id: string } }>('/api/series/:id', async (req, reply) => {
    const s = db.prepare('SELECT * FROM series WHERE id = ?').get(Number(req.params.id)) as Record<string, unknown> | undefined
    if (!s) return bad(reply, 'not found', 404)
    const rules = db.prepare('SELECT * FROM series_rules WHERE series_id = ? ORDER BY id').all(s.id as number)
    const videos = db
      .prepare(`SELECT ${VIDEO_COLS} FROM videos v ${joins(requireUser(req).id)} WHERE v.series_id = ? AND v.unavailable = 0 ORDER BY v.published_at, v.id`)
      .all(s.id as number)
    return { ...s, rules, videos }
  })

  app.put<{ Params: { id: string }; Body: { name?: string; color?: string | null; priority?: number } }>('/api/series/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const s = db.prepare('SELECT channel_id FROM series WHERE id = ?').get(id) as { channel_id: string } | undefined
    if (!s) return bad(reply, 'not found', 404)
    const b = req.body ?? {}
    if (b.name !== undefined) db.prepare('UPDATE series SET name = ? WHERE id = ?').run(b.name.trim(), id)
    if (b.color !== undefined) db.prepare('UPDATE series SET color = ? WHERE id = ?').run(b.color, id)
    if (b.priority !== undefined) {
      db.prepare('UPDATE series SET priority = ? WHERE id = ?').run(Number(b.priority), id)
      applyRules(s.channel_id)
    }
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/series/:id', async (req) => {
    const id = Number(req.params.id)
    const s = db.prepare('SELECT channel_id FROM series WHERE id = ?').get(id) as { channel_id: string } | undefined
    db.prepare('DELETE FROM series WHERE id = ?').run(id)
    if (s) applyRules(s.channel_id)
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { pattern?: string; flags?: string } }>('/api/series/:id/rules', async (req, reply) => {
    const id = Number(req.params.id)
    const s = db.prepare('SELECT channel_id FROM series WHERE id = ?').get(id) as { channel_id: string } | undefined
    if (!s) return bad(reply, 'not found', 404)
    const pattern = req.body?.pattern?.trim()
    const flags = req.body?.flags ?? 'i'
    if (!pattern || !validRegex(pattern, flags)) return bad(reply, 'Invalid regex')
    const row = db.prepare('INSERT INTO series_rules (series_id, pattern, flags) VALUES (?, ?, ?) RETURNING id').get(id, pattern, flags) as { id: number }
    return { id: row.id, ...applyRules(s.channel_id) }
  })

  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (req) => {
    const id = Number(req.params.id)
    const r = db
      .prepare('SELECT s.channel_id FROM series_rules r JOIN series s ON s.id = r.series_id WHERE r.id = ?')
      .get(id) as { channel_id: string } | undefined
    db.prepare('DELETE FROM series_rules WHERE id = ?').run(id)
    if (r) applyRules(r.channel_id)
    return { ok: true }
  })

  /** Preview which titles a regex would catch, before saving it. */
  app.get<{ Params: { id: string }; Querystring: { pattern?: string; flags?: string } }>('/api/channels/:id/series/preview', async (req, reply) => {
    const { pattern, flags = 'i' } = req.query
    if (!pattern || !validRegex(pattern, flags)) return bad(reply, 'Invalid regex')
    const re = new RegExp(pattern, flags)
    const rows = db
      .prepare('SELECT id, title, published_at, series_id FROM videos WHERE channel_id = ? AND unavailable = 0 ORDER BY published_at')
      .all(req.params.id) as { id: string; title: string; published_at: string; series_id: number | null }[]
    const matches = rows.filter((r) => re.test(r.title))
    return { total: matches.length, sample: matches.slice(0, 50) }
  })

  // ---- videos ---------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/videos/:id', async (req, reply) => {
    const J = joins(requireUser(req).id)
    const v = db.prepare(`SELECT ${VIDEO_COLS}, v.description, v.like_count FROM videos v ${J} WHERE v.id = ?`).get(req.params.id) as
      | (VideoRow & Record<string, unknown>)
      | undefined
    if (!v) return bad(reply, 'not found', 404)

    const neighbor = (where: string, order: 'ASC' | 'DESC', params: (string | number)[]) =>
      db
        .prepare(`SELECT ${VIDEO_COLS} FROM videos v ${J} WHERE v.unavailable = 0 AND ${where} ORDER BY v.published_at ${order}, v.id ${order} LIMIT 1`)
        .get(...params) ?? null

    // "Newer/older" walks the whole channel; "next/prev" walks the series.
    const older = neighbor('v.channel_id = ? AND (v.published_at < ? OR (v.published_at = ? AND v.id < ?))', 'DESC', [v.channel_id, v.published_at, v.published_at, v.id])
    const newer = neighbor('v.channel_id = ? AND (v.published_at > ? OR (v.published_at = ? AND v.id > ?))', 'ASC', [v.channel_id, v.published_at, v.published_at, v.id])
    let prevInSeries = null
    let nextInSeries = null
    let episode: { index: number; total: number } | null = null
    if (v.series_id != null) {
      prevInSeries = neighbor('v.series_id = ? AND (v.published_at < ? OR (v.published_at = ? AND v.id < ?))', 'DESC', [v.series_id, v.published_at, v.published_at, v.id])
      nextInSeries = neighbor('v.series_id = ? AND (v.published_at > ? OR (v.published_at = ? AND v.id > ?))', 'ASC', [v.series_id, v.published_at, v.published_at, v.id])
      const before = (db
        .prepare('SELECT COUNT(*) AS n FROM videos WHERE series_id = ? AND unavailable = 0 AND (published_at < ? OR (published_at = ? AND id < ?))')
        .get(v.series_id, v.published_at, v.published_at, v.id) as { n: number }).n
      const total = (db.prepare('SELECT COUNT(*) AS n FROM videos WHERE series_id = ? AND unavailable = 0').get(v.series_id) as { n: number }).n
      episode = { index: before + 1, total }
    }
    const channel = db.prepare('SELECT id, title, handle, thumbnail_url FROM channels WHERE id = ?').get(v.channel_id)
    return { ...v, channel, older, newer, prevInSeries, nextInSeries, episode, localFile: downloads.localFile(v.id) !== null }
  })

  app.put<{ Params: { id: string }; Body: { seriesId?: number | null } }>('/api/videos/:id/series', async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM videos WHERE id = ?').get(req.params.id)) return bad(reply, 'not found', 404)
    const sid = req.body?.seriesId ?? null
    if (sid !== null && !db.prepare('SELECT 1 FROM series WHERE id = ?').get(sid)) return bad(reply, 'series not found', 404)
    db.prepare(`UPDATE videos SET series_id = ?, series_manual = 1, series_source = 'manual' WHERE id = ?`).run(sid, req.params.id)
    return { ok: true }
  })

  /** Clears a manual override so rules apply again. */
  app.delete<{ Params: { id: string } }>('/api/videos/:id/series', async (req) => {
    const v = db.prepare('SELECT channel_id FROM videos WHERE id = ?').get(req.params.id) as { channel_id: string } | undefined
    db.prepare('UPDATE videos SET series_manual = 0, series_source = NULL WHERE id = ?').run(req.params.id)
    if (v) applyRules(v.channel_id)
    return { ok: true }
  })

  // ---- progress -------------------------------------------------------------
  app.put<{ Params: { id: string }; Body: { position?: number; duration?: number; completed?: boolean } }>('/api/videos/:id/progress', async (req, reply) => {
    if (!db.prepare('SELECT 1 FROM videos WHERE id = ?').get(req.params.id)) return bad(reply, 'not found', 404)
    const b = req.body ?? {}
    const position = Math.max(0, Number(b.position) || 0)
    const duration = Math.max(0, Number(b.duration) || 0)
    const completed = b.completed ?? (duration > 0 && position / duration > 0.95)
    db.prepare(
      `INSERT INTO watch_progress (user_id, video_id, position_seconds, duration_seconds, completed, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, video_id) DO UPDATE SET position_seconds = excluded.position_seconds, duration_seconds = excluded.duration_seconds,
         completed = excluded.completed, updated_at = excluded.updated_at`,
    ).run(requireUser(req).id, req.params.id, position, duration, completed ? 1 : 0, new Date().toISOString())
    return { ok: true }
  })

  // ---- downloads ------------------------------------------------------------
  app.get('/api/downloads', async () =>
    db
      .prepare(`SELECT d.*, v.title, v.thumbnail_url, v.channel_id FROM downloads d JOIN videos v ON v.id = d.video_id ORDER BY d.updated_at DESC`)
      .all(),
  )
  app.post<{ Params: { id: string } }>('/api/videos/:id/download', async (req, reply) => {
    if (!downloads.ytDlpAvailable()) return bad(reply, 'yt-dlp is not installed in this container')
    if (!db.prepare('SELECT 1 FROM videos WHERE id = ?').get(req.params.id)) return bad(reply, 'not found', 404)
    downloads.enqueue(req.params.id)
    return { ok: true }
  })
  app.post<{ Params: { id: string } }>('/api/series/:id/download', async (req, reply) => {
    if (!downloads.ytDlpAvailable()) return bad(reply, 'yt-dlp is not installed in this container')
    const ids = db.prepare('SELECT id FROM videos WHERE series_id = ? AND unavailable = 0 ORDER BY published_at').all(Number(req.params.id)) as { id: string }[]
    ids.forEach((r) => downloads.enqueue(r.id))
    return { queued: ids.length }
  })
  app.delete<{ Params: { id: string } }>('/api/videos/:id/download', async (req) => {
    downloads.cancel(req.params.id)
    return { ok: true }
  })
}

function validRegex(p: string, flags = 'i') {
  try {
    new RegExp(p, flags)
    return true
  } catch {
    return false
  }
}
