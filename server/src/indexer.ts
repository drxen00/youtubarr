import { db, getSetting, transaction } from './db.js'
import { config } from './config.js'
import { fetchChannel, fetchVideos, playlistVideoIds, YouTubeApiError } from './youtube.js'
import { applyRules } from './series.js'
import { autoOrganise, isOrganised } from './organise.js'

export function apiKey(): string {
  const key = getSetting('youtube_api_key') || config.youtubeApiKey
  if (!key) throw new YouTubeApiError('No YouTube API key configured. An admin can add one in Settings.', 400, 'noApiKey')
  return key
}

export interface SyncStatus {
  state: 'idle' | 'running' | 'error'
  phase?: 'fetching' | 'organising'
  full: boolean
  fetched: number
  total: number
  startedAt?: string
  finishedAt?: string
  error?: string
}

const status = new Map<string, SyncStatus>()

export function syncStatus(channelId: string): SyncStatus {
  return status.get(channelId) ?? { state: 'idle', full: false, fetched: 0, total: 0 }
}

const upsertVideo = db.prepare(`
  INSERT INTO videos (id, channel_id, title, description, published_at, duration_seconds, thumbnail_url, view_count, like_count, indexed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    title = excluded.title, description = excluded.description, published_at = excluded.published_at,
    duration_seconds = excluded.duration_seconds, thumbnail_url = excluded.thumbnail_url,
    view_count = excluded.view_count, like_count = excluded.like_count, unavailable = 0, indexed_at = excluded.indexed_at
`)

/** Adds a channel (metadata only) and kicks off a full sync; the adding user gets auto-organised afterwards. */
export async function addChannel(input: string, userId: number) {
  const info = await fetchChannel(apiKey(), input)
  db.prepare(
    `INSERT INTO channels (id, title, handle, description, thumbnail_url, banner_url, uploads_playlist_id, video_count, subscriber_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, handle = excluded.handle, description = excluded.description,
       thumbnail_url = excluded.thumbnail_url, banner_url = excluded.banner_url, uploads_playlist_id = excluded.uploads_playlist_id,
       video_count = excluded.video_count, subscriber_count = excluded.subscriber_count`,
  ).run(info.id, info.title, info.handle, info.description, info.thumbnailUrl, info.bannerUrl, info.uploadsPlaylistId, info.videoCount, info.subscriberCount)
  void syncChannel(info.id, { full: true, organiseFor: userId })
  return { id: info.id }
}

/**
 * Pulls the uploads playlist. Incremental mode stops at the first page where every id is already known
 * (uploads are newest-first), which keeps routine refreshes to a couple of quota units.
 */
export async function syncChannel(channelId: string, opts: { full?: boolean; organiseFor?: number } = {}): Promise<void> {
  const current = status.get(channelId)
  if (current?.state === 'running') return
  const ch = db.prepare('SELECT uploads_playlist_id, video_count FROM channels WHERE id = ?').get(channelId) as
    | { uploads_playlist_id: string; video_count: number }
    | undefined
  if (!ch) throw new Error('channel not found')

  const st: SyncStatus = { state: 'running', phase: 'fetching', full: !!opts.full, fetched: 0, total: ch.video_count, startedAt: new Date().toISOString() }
  status.set(channelId, st)

  try {
    const key = apiKey()
    const known = new Set((db.prepare('SELECT id FROM videos WHERE channel_id = ?').all(channelId) as { id: string }[]).map((r) => r.id))
    const seen = new Set<string>()

    for await (const ids of playlistVideoIds(key, ch.uploads_playlist_id)) {
      const fresh = ids.filter((id) => !known.has(id))
      ids.forEach((id) => seen.add(id))
      if (!opts.full && fresh.length === 0) break

      const details = await fetchVideos(key, ids)
      const now = new Date().toISOString()
      transaction(() => {
        for (const v of details) {
          upsertVideo.run(v.id, channelId, v.title, v.description, v.publishedAt, v.durationSeconds, v.thumbnailUrl, v.viewCount, v.likeCount, now)
        }
      })
      st.fetched += ids.length
    }

    if (opts.full) {
      // Anything we didn't see this pass has gone private/deleted. Keep the row so watch history survives.
      const gone = [...known].filter((id) => !seen.has(id))
      if (gone.length) {
        const mark = db.prepare('UPDATE videos SET unavailable = 1 WHERE id = ?')
        transaction(() => gone.forEach((id) => mark.run(id)))
      }
    }

    // New uploads need sorting for everyone who has rules on this channel.
    const owners = db.prepare('SELECT DISTINCT user_id FROM series WHERE channel_id = ? AND user_id IS NOT NULL').all(channelId) as { user_id: number }[]
    for (const o of owners) applyRules(channelId, o.user_id)

    db.prepare('UPDATE channels SET last_synced_at = ?, video_count = (SELECT COUNT(*) FROM videos WHERE channel_id = ? AND unavailable = 0) WHERE id = ?')
      .run(new Date().toISOString(), channelId, channelId)

    if (opts.organiseFor && !isOrganised(opts.organiseFor, channelId)) {
      st.phase = 'organising'
      await autoOrganise(key, channelId, opts.organiseFor)
    }
    st.state = 'idle'
  } catch (e) {
    st.state = 'error'
    st.error = e instanceof Error ? e.message : String(e)
  } finally {
    st.finishedAt = new Date().toISOString()
  }
}
