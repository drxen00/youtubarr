import type { FastifyInstance, FastifyReply } from 'fastify'
import { config } from './config.js'
import { db, getSetting, setSetting } from './db.js'
import { addChannel, apiKey, syncChannel, syncStatus } from './indexer.js'
import { autoOrganise, copySetup, createFromSuggestions, importPlaylists, isOrganised, otherSetups, suggestForChannel } from './organise.js'
import { applyRules, findSeedFor, importSeed, listSeeds, seriesOwner } from './series.js'
import * as downloads from './downloads.js'
import { requireUser } from './auth.js'
import { YouTubeApiError } from './youtube.js'

const VIDEO_COLS = `v.id, v.channel_id, v.title, v.published_at, v.duration_seconds, v.thumbnail_url, v.view_count, v.unavailable,
  vs.series_id, vs.source AS series_source, s.name AS series_name, s.color AS series_color,
  p.position_seconds AS progress_position, p.duration_seconds AS progress_duration, p.completed AS progress_completed,
  d.status AS download_status, d.progress AS download_progress`

/** Series and progress are per user; `userId` is a server-issued integer, so inlining it is safe. */
const joins = (userId: number) => `LEFT JOIN video_series vs ON vs.video_id = v.id AND vs.user_id = ${Number(userId)}
  LEFT JOIN series s ON s.id = vs.series_id
  LEFT JOIN watch_progress p ON p.video_id = v.id AND p.user_id = ${Number(userId)}
  LEFT JOIN downloads d ON d.video_id = v.id`

function bad(reply: FastifyReply, msg: string, code = 400) {
  return reply.code(code).send({ error: msg })
}

async function ytCall<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof YouTubeApiError) {
      bad(reply, e.message, e.status === 404 ? 404 : 400)
      return undefined
    }
    throw e
  }
}

function validRegex(p: string, flags = 'i') {
  try {
    new RegExp(p, flags)
    return true
  } catch {
    return false
  }
}

export function registerRoutes(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true }))

  // ---- settings (admin; enforced in auth.ts) --------------------------------
  app.get('/api/settings', async () => ({
    youtubeApiKeySet: !!(getSetting('youtube_api_key') || config.youtubeApiKey),
    youtubeApiKeyFromEnv: !getSetting('youtube_api_key') && !!config.youtubeApiKey,
    mediaDir: config.mediaDir,
    dataDir: config.dataDir,
    seeds: listSeeds(),
  }))
  app.put<{ Body: { youtubeApiKey?: string | null } }>('/api/settings', async (req) => {
    if ('youtubeApiKey' in req.body) setSetting('youtube_api_key', req.body.youtubeApiKey ? req.body.youtubeApiKey.trim() : null)
    return { ok: true }
  })

  // ---- channels -------------------------------------------------------------
  app.get('/api/channels', async (req) => {
    const uid = requireUser(req).id
    const rows = db
      .prepare(
        `SELECT c.*, (SELECT COUNT(*) FROM videos v WHERE v.channel_id = c.id AND v.unavailable = 0) AS indexed_count,
                (SELECT COUNT(*) FROM series s WHERE s.channel_id = c.id AND s.user_id = ?) AS series_count,
                (SELECT COUNT(*) FROM downloads d JOIN videos v ON v.id = d.video_id WHERE v.channel_id = c.id AND d.status = 'done') AS downloaded_count
         FROM channels c ORDER BY c.added_at`,
      )
      .all(uid) as Record<string, unknown>[]
    return rows.map((c) => ({ ...c, sync: syncStatus(c.id as string), organised: isOrganised(uid, c.id as string) }))
  })

  app.post<{ Body: { input?: string } }>('/api/channels', async (req, reply) => {
    if (!req.body?.input) return bad(reply, 'input is required')
    return ytCall(reply, () => addChannel(req.body.input!, requireUser(req).id))
  })

  app.get<{ Params: { id: string } }>('/api/channels/:id', async (req, reply) => {
    const uid = requireUser(req).id
    const c = db.prepare('SELECT * FROM channels WHERE id = ?').get(req.params.id) as Record<string, unknown> | undefined
    if (!c) return bad(reply, 'not found', 404)
    const years = db
      .prepare(`SELECT substr(published_at, 1, 4) AS year, COUNT(*) AS count FROM videos WHERE channel_id = ? AND unavailable = 0 GROUP BY year ORDER BY year`)
      .all(req.params.id)
    const downloaded = (db
      .prepare(`SELECT COUNT(*) AS n FROM downloads d JOIN videos v ON v.id = d.video_id WHERE v.channel_id = ? AND d.status = 'done'`)
      .get(req.params.id) as { n: number }).n
    return { ...c, sync: syncStatus(req.params.id), years, organised: isOrganised(uid, req.params.id), downloaded_count: downloaded, seed: findSeedFor(req.params.id, c.handle as string | null) }
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
    const uid = requireUser(req).id
    const where = ['v.channel_id = ?', 'v.unavailable = 0']
    const params: (string | number)[] = [req.params.id]
    if (req.query.series === 'none') where.push('vs.series_id IS NULL')
    else if (req.query.series) {
      where.push('vs.series_id = ?')
      params.push(Number(req.query.series))
    }
    return db
      .prepare(
        `SELECT substr(v.published_at, 1, 7) AS month, COUNT(*) AS count FROM videos v
         LEFT JOIN video_series vs ON vs.video_id = v.id AND vs.user_id = ${uid}
         WHERE ${where.join(' AND ')} GROUP BY month ORDER BY month`,
      )
      .all(...params)
  })

  app.get<{
    Params: { id: string }
    Querystring: { series?: string; q?: string; year?: string; from?: string; to?: string; sort?: string; limit?: string; offset?: string; downloaded?: string }
  }>('/api/channels/:id/videos', async (req) => {
    const uid = requireUser(req).id
    const q = req.query
    const where = ['v.channel_id = ?', 'v.unavailable = 0']
    const params: (string | number)[] = [req.params.id]
    if (q.series === 'none') where.push('vs.series_id IS NULL')
    else if (q.series) {
      where.push('vs.series_id = ?')
      params.push(Number(q.series))
    }
    if (q.q) {
      where.push("v.title LIKE ? ESCAPE '\\'")
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
    if (q.downloaded === '1') where.push("d.status = 'done'")
    const sort =
      { oldest: 'v.published_at ASC', views: 'v.view_count DESC', longest: 'v.duration_seconds DESC', newest: 'v.published_at DESC' }[q.sort ?? 'newest'] ??
      'v.published_at DESC'
    const limit = Math.min(Math.max(Number(q.limit) || 60, 1), 500)
    const offset = Math.max(Number(q.offset) || 0, 0)
    const J = joins(uid)
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM videos v ${J} WHERE ${where.join(' AND ')}`).get(...params) as { n: number }).n
    const items = db.prepare(`SELECT ${VIDEO_COLS} FROM videos v ${J} WHERE ${where.join(' AND ')} ORDER BY ${sort}, v.id LIMIT ? OFFSET ?`).all(...params, limit, offset)
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

  // ---- series (per user) ----------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/channels/:id/series', async (req) => {
    const uid = requireUser(req).id
    return db
      .prepare(
        `SELECT s.*, COUNT(vs.video_id) AS video_count, MIN(v.published_at) AS first_at, MAX(v.published_at) AS last_at,
                (SELECT v2.thumbnail_url FROM video_series x JOIN videos v2 ON v2.id = x.video_id WHERE x.series_id = s.id AND v2.unavailable = 0 ORDER BY v2.published_at LIMIT 1) AS thumbnail_url,
                (SELECT COUNT(*) FROM series_rules r WHERE r.series_id = s.id) AS rule_count,
                (SELECT COUNT(*) FROM video_series x JOIN watch_progress p ON p.video_id = x.video_id AND p.user_id = s.user_id WHERE x.series_id = s.id AND p.completed = 1) AS watched_count,
                (SELECT COUNT(*) FROM video_series x JOIN downloads d ON d.video_id = x.video_id WHERE x.series_id = s.id AND d.status = 'done') AS downloaded_count
         FROM series s
         LEFT JOIN video_series vs ON vs.series_id = s.id
         LEFT JOIN videos v ON v.id = vs.video_id AND v.unavailable = 0
         WHERE s.channel_id = ? AND s.user_id = ? GROUP BY s.id ORDER BY video_count DESC, s.name`,
      )
      .all(req.params.id, uid)
  })

  app.post<{ Params: { id: string }; Body: { name?: string; color?: string; priority?: number; patterns?: string[] } }>('/api/channels/:id/series', async (req, reply) => {
    const uid = requireUser(req).id
    const name = req.body?.name?.trim()
    if (!name) return bad(reply, 'name is required')
    for (const p of req.body.patterns ?? []) if (!validRegex(p)) return bad(reply, `Invalid regex: ${p}`)
    try {
      const row = db
        .prepare('INSERT INTO series (user_id, channel_id, name, color, priority) VALUES (?, ?, ?, ?, ?) RETURNING id')
        .get(uid, req.params.id, name, req.body.color ?? null, req.body.priority ?? 0) as { id: number }
      for (const p of req.body.patterns ?? []) db.prepare('INSERT INTO series_rules (series_id, pattern) VALUES (?, ?)').run(row.id, p)
      applyRules(req.params.id, uid)
      return { id: row.id }
    } catch (e) {
      if (String(e).includes('UNIQUE')) return bad(reply, 'You already have a series with that name', 409)
      throw e
    }
  })

  app.post<{ Params: { id: string } }>('/api/channels/:id/series/apply', async (req) => applyRules(req.params.id, requireUser(req).id))

  /** Preview which titles a regex would catch, before saving it. */
  app.get<{ Params: { id: string }; Querystring: { pattern?: string; flags?: string } }>('/api/channels/:id/series/preview', async (req, reply) => {
    const { pattern, flags = 'i' } = req.query
    if (!pattern || !validRegex(pattern, flags)) return bad(reply, 'Invalid regex')
    const re = new RegExp(pattern, flags)
    const rows = db
      .prepare('SELECT id, title, published_at FROM videos WHERE channel_id = ? AND unavailable = 0 ORDER BY published_at')
      .all(req.params.id) as { id: string; title: string; published_at: string }[]
    const matches = rows.filter((r) => re.test(r.title))
    return { total: matches.length, sample: matches.slice(0, 50) }
  })

  // ---- organisers (per user) ------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/channels/:id/organise', async (req, reply) => {
    const uid = requireUser(req).id
    const c = db.prepare('SELECT handle FROM channels WHERE id = ?').get(req.params.id) as { handle: string | null } | undefined
    if (!c) return bad(reply, 'not found', 404)
    return { organised: isOrganised(uid, req.params.id), seed: findSeedFor(req.params.id, c.handle), others: otherSetups(req.params.id, uid) }
  })
  app.post<{ Params: { id: string } }>('/api/channels/:id/organise/auto', async (req, reply) => ytCall(reply, () => autoOrganise(apiKey(), req.params.id, requireUser(req).id)))
  app.post<{ Params: { id: string } }>('/api/channels/:id/organise/playlists', async (req, reply) => ytCall(reply, () => importPlaylists(apiKey(), req.params.id, requireUser(req).id)))
  app.post<{ Params: { id: string }; Body: { file?: string } }>('/api/channels/:id/organise/seed', async (req, reply) => {
    const uid = requireUser(req).id
    const c = db.prepare('SELECT handle FROM channels WHERE id = ?').get(req.params.id) as { handle: string | null } | undefined
    if (!c) return bad(reply, 'not found', 404)
    const file = req.body?.file || findSeedFor(req.params.id, c.handle)
    if (!file) return bad(reply, 'No starter ruleset for this channel')
    const r = importSeed(req.params.id, uid, file)
    const applied = applyRules(req.params.id, uid)
    db.prepare(`INSERT INTO user_channels (user_id, channel_id, organised) VALUES (?, ?, 1) ON CONFLICT(user_id, channel_id) DO UPDATE SET organised = 1`).run(uid, req.params.id)
    return { ...r, ...applied }
  })
  app.post<{ Params: { id: string }; Body: { fromUserId?: number } }>('/api/channels/:id/organise/copy', async (req, reply) => {
    const uid = requireUser(req).id
    const from = Number(req.body?.fromUserId)
    if (!from || from === uid) return bad(reply, 'fromUserId required')
    return copySetup(req.params.id, from, uid)
  })
  app.get<{ Params: { id: string }; Querystring: { min?: string } }>('/api/channels/:id/organise/suggest', async (req) =>
    suggestForChannel(req.params.id, requireUser(req).id, Math.max(2, Number(req.query.min) || 3)),
  )
  app.post<{ Params: { id: string }; Body: { picks?: { name: string; pattern: string }[] } }>('/api/channels/:id/organise/create', async (req, reply) => {
    const picks = req.body?.picks
    if (!Array.isArray(picks) || picks.length === 0) return bad(reply, 'picks required')
    return { created: createFromSuggestions(req.params.id, requireUser(req).id, picks) }
  })

  // ---- one series ------------------------------------------------------------
  const ownSeries = (req: { params: { id: string } }, reply: FastifyReply, uid: number) => {
    const id = Number(req.params.id)
    const s = seriesOwner(id)
    if (!s || s.user_id !== uid) {
      bad(reply, 'not found', 404)
      return null
    }
    return { id, channel_id: s.channel_id }
  }

  app.get<{ Params: { id: string } }>('/api/series/:id', async (req, reply) => {
    const uid = requireUser(req).id
    const own = ownSeries(req, reply, uid)
    if (!own) return
    const s = db.prepare('SELECT * FROM series WHERE id = ?').get(own.id) as Record<string, unknown>
    const rules = db.prepare('SELECT * FROM series_rules WHERE series_id = ? ORDER BY id').all(own.id)
    const videos = db
      .prepare(`SELECT ${VIDEO_COLS} FROM videos v ${joins(uid)} WHERE vs.series_id = ? AND v.unavailable = 0 ORDER BY v.published_at, v.id`)
      .all(own.id)
    return { ...s, rules, videos }
  })

  app.put<{ Params: { id: string }; Body: { name?: string; color?: string | null; priority?: number } }>('/api/series/:id', async (req, reply) => {
    const uid = requireUser(req).id
    const own = ownSeries(req, reply, uid)
    if (!own) return
    const b = req.body ?? {}
    if (b.name !== undefined) db.prepare('UPDATE series SET name = ? WHERE id = ?').run(b.name.trim(), own.id)
    if (b.color !== undefined) db.prepare('UPDATE series SET color = ? WHERE id = ?').run(b.color, own.id)
    if (b.priority !== undefined) {
      db.prepare('UPDATE series SET priority = ? WHERE id = ?').run(Number(b.priority), own.id)
      applyRules(own.channel_id, uid)
    }
    return { ok: true }
  })

  app.delete<{ Params: { id: string } }>('/api/series/:id', async (req, reply) => {
    const uid = requireUser(req).id
    const own = ownSeries(req, reply, uid)
    if (!own) return
    db.prepare('DELETE FROM series WHERE id = ?').run(own.id)
    applyRules(own.channel_id, uid)
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { pattern?: string; flags?: string } }>('/api/series/:id/rules', async (req, reply) => {
    const uid = requireUser(req).id
    const own = ownSeries(req, reply, uid)
    if (!own) return
    const pattern = req.body?.pattern?.trim()
    const flags = req.body?.flags ?? 'i'
    if (!pattern || !validRegex(pattern, flags)) return bad(reply, 'Invalid regex')
    const row = db.prepare('INSERT INTO series_rules (series_id, pattern, flags) VALUES (?, ?, ?) RETURNING id').get(own.id, pattern, flags) as { id: number }
    return { id: row.id, ...applyRules(own.channel_id, uid) }
  })

  app.delete<{ Params: { id: string } }>('/api/rules/:id', async (req, reply) => {
    const uid = requireUser(req).id
    const id = Number(req.params.id)
    const r = db
      .prepare('SELECT s.user_id, s.channel_id FROM series_rules r JOIN series s ON s.id = r.series_id WHERE r.id = ?')
      .get(id) as { user_id: number; channel_id: string } | undefined
    if (!r || r.user_id !== uid) return bad(reply, 'not found', 404)
    db.prepare('DELETE FROM series_rules WHERE id = ?').run(id)
    applyRules(r.channel_id, uid)
    return { ok: true }
  })

  // ---- videos ---------------------------------------------------------------
  app.get<{ Params: { id: string } }>('/api/videos/:id', async (req, reply) => {
    const uid = requireUser(req).id
    const J = joins(uid)
    const v = db.prepare(`SELECT ${VIDEO_COLS}, v.description, v.like_count FROM videos v ${J} WHERE v.id = ?`).get(req.params.id) as
      | { id: string; channel_id: string; published_at: string; series_id: number | null }
      | undefined
    if (!v) return bad(reply, 'not found', 404)

    const neighbor = (where: string, order: 'ASC' | 'DESC', params: (string | number)[]) =>
      db.prepare(`SELECT ${VIDEO_COLS} FROM videos v ${J} WHERE v.unavailable = 0 AND ${where} ORDER BY v.published_at ${order}, v.id ${order} LIMIT 1`).get(...params) ?? null

    // "Newer/older" walks the whole channel; "next/prev" walks this user's series.
    const older = neighbor('v.channel_id = ? AND (v.published_at < ? OR (v.published_at = ? AND v.id < ?))', 'DESC', [v.channel_id, v.published_at, v.published_at, v.id])
    const newer = neighbor('v.channel_id = ? AND (v.published_at > ? OR (v.published_at = ? AND v.id > ?))', 'ASC', [v.channel_id, v.published_at, v.published_at, v.id])
    let prevInSeries = null
    let nextInSeries = null
    let episode: { index: number; total: number } | null = null
    if (v.series_id != null) {
      prevInSeries = neighbor('vs.series_id = ? AND (v.published_at < ? OR (v.published_at = ? AND v.id < ?))', 'DESC', [v.series_id, v.published_at, v.published_at, v.id])
      nextInSeries = neighbor('vs.series_id = ? AND (v.published_at > ? OR (v.published_at = ? AND v.id > ?))', 'ASC', [v.series_id, v.published_at, v.published_at, v.id])
      const counts = db
        .prepare(
          `SELECT SUM(CASE WHEN v.published_at < ? OR (v.published_at = ? AND v.id < ?) THEN 1 ELSE 0 END) AS before, COUNT(*) AS total
           FROM video_series x JOIN videos v ON v.id = x.video_id WHERE x.series_id = ? AND v.unavailable = 0`,
        )
        .get(v.published_at, v.published_at, v.id, v.series_id) as { before: number; total: number }
      episode = { index: (counts.before ?? 0) + 1, total: counts.total }
    }
    const channel = db.prepare('SELECT id, title, handle, thumbnail_url FROM channels WHERE id = ?').get(v.channel_id)
    return { ...v, channel, older, newer, prevInSeries, nextInSeries, episode, localFile: downloads.localFile(v.id) !== null }
  })

  app.put<{ Params: { id: string }; Body: { seriesId?: number | null } }>('/api/videos/:id/series', async (req, reply) => {
    const uid = requireUser(req).id
    if (!db.prepare('SELECT 1 FROM videos WHERE id = ?').get(req.params.id)) return bad(reply, 'not found', 404)
    const sid = req.body?.seriesId ?? null
    if (sid !== null) {
      const owner = seriesOwner(sid)
      if (!owner || owner.user_id !== uid) return bad(reply, 'series not found', 404)
    }
    // A NULL series with source 'manual' pins "no series" so rules don't re-add it.
    db.prepare(
      `INSERT INTO video_series (user_id, video_id, series_id, source) VALUES (?, ?, ?, 'manual')
       ON CONFLICT(user_id, video_id) DO UPDATE SET series_id = excluded.series_id, source = 'manual'`,
    ).run(uid, req.params.id, sid)
    return { ok: true }
  })

  /** Clears a manual override so rules apply again. */
  app.delete<{ Params: { id: string } }>('/api/videos/:id/series', async (req) => {
    const uid = requireUser(req).id
    const v = db.prepare('SELECT channel_id FROM videos WHERE id = ?').get(req.params.id) as { channel_id: string } | undefined
    db.prepare('DELETE FROM video_series WHERE user_id = ? AND video_id = ?').run(uid, req.params.id)
    if (v) applyRules(v.channel_id, uid)
    return { ok: true }
  })

  // ---- progress (per user) --------------------------------------------------
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

  // ---- downloads (shared) ---------------------------------------------------
  app.get('/api/downloads', async () => ({
    ytDlpVersion: downloads.ytDlpAvailable(),
    items: db
      .prepare(`SELECT d.*, v.title, v.thumbnail_url, v.channel_id, v.duration_seconds FROM downloads d JOIN videos v ON v.id = d.video_id ORDER BY d.updated_at DESC`)
      .all(),
  }))
  app.post<{ Params: { id: string } }>('/api/videos/:id/download', async (req, reply) => {
    if (!downloads.ytDlpAvailable()) return bad(reply, 'yt-dlp is not installed in this container')
    if (!db.prepare('SELECT 1 FROM videos WHERE id = ?').get(req.params.id)) return bad(reply, 'not found', 404)
    downloads.enqueue(req.params.id)
    return { ok: true }
  })
  app.post<{ Params: { id: string } }>('/api/series/:id/download', async (req, reply) => {
    if (!downloads.ytDlpAvailable()) return bad(reply, 'yt-dlp is not installed in this container')
    const own = ownSeries(req, reply, requireUser(req).id)
    if (!own) return
    const ids = db
      .prepare(
        `SELECT v.id FROM video_series x JOIN videos v ON v.id = x.video_id LEFT JOIN downloads d ON d.video_id = v.id
         WHERE x.series_id = ? AND v.unavailable = 0 AND (d.status IS NULL OR d.status = 'error') ORDER BY v.published_at`,
      )
      .all(own.id) as { id: string }[]
    ids.forEach((r) => downloads.enqueue(r.id))
    return { queued: ids.length }
  })
  app.delete<{ Params: { id: string } }>('/api/videos/:id/download', async (req) => {
    downloads.cancel(req.params.id)
    return { ok: true }
  })
}
