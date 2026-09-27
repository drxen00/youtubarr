/** Thin YouTube Data API v3 client. Quota notes: list calls cost 1 unit each regardless of page size. */

const BASE = 'https://www.googleapis.com/youtube/v3'

export class YouTubeApiError extends Error {
  constructor(message: string, public status: number, public reason?: string) {
    super(message)
  }
}

export interface ChannelInfo {
  id: string
  title: string
  handle: string | null
  description: string
  thumbnailUrl: string | null
  bannerUrl: string | null
  uploadsPlaylistId: string
  videoCount: number
  subscriberCount: number | null
}

export interface VideoInfo {
  id: string
  title: string
  description: string
  publishedAt: string
  durationSeconds: number
  thumbnailUrl: string | null
  viewCount: number | null
  likeCount: number | null
}

type Json = Record<string, any>

async function get(apiKey: string, resource: string, params: Record<string, string>): Promise<Json> {
  const url = new URL(`${BASE}/${resource}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  url.searchParams.set('key', apiKey)
  const res = await fetch(url)
  if (!res.ok) {
    let reason: string | undefined
    let message = `YouTube API ${res.status}`
    try {
      const body = (await res.json()) as Json
      reason = body?.error?.errors?.[0]?.reason
      message = body?.error?.message || message
    } catch {
      /* ignore */
    }
    throw new YouTubeApiError(message, res.status, reason)
  }
  return (await res.json()) as Json
}

/** Accepts a handle, channel id, legacy username, or any youtube.com channel URL. */
export function parseChannelInput(input: string): { id?: string; handle?: string; username?: string } {
  const s = input.trim()
  if (/^UC[\w-]{22}$/.test(s)) return { id: s }
  if (/^@[\w.-]+$/.test(s)) return { handle: s }
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`)
    if (!/youtube\.com$/.test(u.hostname)) throw new Error('not youtube')
    const parts = u.pathname.split('/').filter(Boolean)
    if (parts[0]?.startsWith('@')) return { handle: parts[0] }
    if (parts[0] === 'channel' && parts[1]) return { id: parts[1] }
    if ((parts[0] === 'c' || parts[0] === 'user') && parts[1]) return { username: parts[1] }
  } catch {
    /* fall through */
  }
  // bare word: treat as a handle
  if (/^[\w.-]+$/.test(s)) return { handle: `@${s}` }
  throw new Error(`Cannot understand channel reference: ${input}`)
}

function bestThumb(thumbs: Json | undefined): string | null {
  if (!thumbs) return null
  return thumbs.maxres?.url || thumbs.standard?.url || thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || null
}

export async function fetchChannel(apiKey: string, input: string): Promise<ChannelInfo> {
  const ref = parseChannelInput(input)
  const params: Record<string, string> = { part: 'snippet,contentDetails,statistics,brandingSettings' }
  if (ref.id) params.id = ref.id
  else if (ref.handle) params.forHandle = ref.handle
  else if (ref.username) params.forUsername = ref.username
  const data = await get(apiKey, 'channels', params)
  const item = data.items?.[0]
  if (!item) throw new YouTubeApiError(`Channel not found: ${input}`, 404, 'notFound')
  return {
    id: item.id,
    title: item.snippet.title,
    handle: item.snippet.customUrl || null,
    description: item.snippet.description || '',
    thumbnailUrl: bestThumb(item.snippet.thumbnails),
    bannerUrl: item.brandingSettings?.image?.bannerExternalUrl || null,
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads,
    videoCount: Number(item.statistics?.videoCount ?? 0),
    subscriberCount: item.statistics?.subscriberCount != null ? Number(item.statistics.subscriberCount) : null,
  }
}

/** Yields pages of video ids from a playlist, newest first. */
export async function* playlistVideoIds(apiKey: string, playlistId: string): AsyncGenerator<string[]> {
  let pageToken: string | undefined
  do {
    const params: Record<string, string> = { part: 'contentDetails', playlistId, maxResults: '50' }
    if (pageToken) params.pageToken = pageToken
    const data = await get(apiKey, 'playlistItems', params)
    const ids: string[] = (data.items ?? []).map((i: Json) => i.contentDetails.videoId)
    yield ids
    pageToken = data.nextPageToken
  } while (pageToken)
}

/** ISO 8601 duration (PT1H2M3S) -> seconds. */
export function parseDuration(iso: string | undefined): number {
  if (!iso) return 0
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso)
  if (!m) return 0
  const [, d, h, mi, s] = m
  return (Number(d ?? 0) * 86400) + (Number(h ?? 0) * 3600) + (Number(mi ?? 0) * 60) + Number(s ?? 0)
}

/** Fetches details for up to 50 ids. Ids missing from the response are private/deleted. */
export async function fetchVideos(apiKey: string, ids: string[]): Promise<VideoInfo[]> {
  if (ids.length === 0) return []
  const data = await get(apiKey, 'videos', { part: 'snippet,contentDetails,statistics', id: ids.slice(0, 50).join(','), maxResults: '50' })
  return (data.items ?? []).map((v: Json): VideoInfo => ({
    id: v.id,
    title: v.snippet.title,
    description: v.snippet.description || '',
    publishedAt: v.snippet.publishedAt,
    durationSeconds: parseDuration(v.contentDetails?.duration),
    thumbnailUrl: bestThumb(v.snippet.thumbnails),
    viewCount: v.statistics?.viewCount != null ? Number(v.statistics.viewCount) : null,
    likeCount: v.statistics?.likeCount != null ? Number(v.statistics.likeCount) : null,
  }))
}
