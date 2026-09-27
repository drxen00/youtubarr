export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export const UNAUTHORIZED_EVENT = 'youtubarr:unauthorized'

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string>) }
  let body = init?.body
  if (init?.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  const res = await fetch(path, { ...init, headers, body, credentials: 'same-origin' })
  if (res.status === 401) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ApiError('Unauthorized', 401)
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = ((await res.json()) as { error?: string }).error || msg
    } catch {
      /* ignore */
    }
    throw new ApiError(msg, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v))
  const s = u.toString()
  return s ? `?${s}` : ''
}

// ---- types (mirror server/src/routes.ts) ------------------------------------

export interface User {
  id: number
  username: string
  role: 'admin' | 'user'
  created_at: string
  last_login_at: string | null
}

export interface AuthStatus {
  setupRequired: boolean
  authenticated: boolean
  user: User | null
}

export interface SyncStatus {
  state: 'idle' | 'running' | 'error'
  phase?: 'fetching' | 'organising'
  full: boolean
  fetched: number
  total: number
  error?: string
  finishedAt?: string
}

export interface Channel {
  id: string
  title: string
  handle: string | null
  description: string
  thumbnail_url: string | null
  banner_url: string | null
  video_count: number
  subscriber_count: number | null
  last_synced_at: string | null
  indexed_count?: number
  series_count?: number
  downloaded_count?: number
  organised: boolean
  seed?: string | null
  sync: SyncStatus
  years?: { year: string; count: number }[]
}

export type SeriesSource = 'rules' | 'playlist' | 'detected' | 'seed'

export interface Video {
  id: string
  channel_id: string
  title: string
  published_at: string
  duration_seconds: number
  thumbnail_url: string | null
  view_count: number | null
  unavailable: number
  series_id: number | null
  series_source: 'rule' | 'playlist' | 'manual' | null
  series_name: string | null
  series_color: string | null
  progress_position: number | null
  progress_duration: number | null
  progress_completed: number | null
  download_status: 'queued' | 'downloading' | 'done' | 'error' | null
  download_progress: number | null
}

export interface VideoDetail extends Video {
  description: string
  like_count: number | null
  channel: { id: string; title: string; handle: string | null; thumbnail_url: string | null }
  older: Video | null
  newer: Video | null
  prevInSeries: Video | null
  nextInSeries: Video | null
  episode: { index: number; total: number } | null
  localFile: boolean
}

export interface Series {
  id: number
  user_id: number
  channel_id: string
  name: string
  color: string | null
  priority: number
  source: SeriesSource
  playlist_id: string | null
  video_count: number
  first_at: string | null
  last_at: string | null
  thumbnail_url: string | null
  rule_count: number
  watched_count: number
  downloaded_count: number
}

export interface Rule {
  id: number
  series_id: number
  pattern: string
  flags: string
  enabled: number
}

export interface SeriesDetail {
  id: number
  user_id: number
  channel_id: string
  name: string
  color: string | null
  priority: number
  source: SeriesSource
  playlist_id: string | null
  rules: Rule[]
  videos: Video[]
}

export interface Suggestion {
  name: string
  pattern: string
  count: number
  videoIds: string[]
  sample: string[]
}

export interface OrganiseInfo {
  organised: boolean
  seed: string | null
  others: { user_id: number; username: string; series_count: number; assigned_count: number }[]
}

export interface Page<T> {
  total: number
  limit: number
  offset: number
  items: T[]
}

export interface Settings {
  youtubeApiKeySet: boolean
  youtubeApiKeyFromEnv: boolean
  mediaDir: string
  dataDir: string
  seeds: { file: string; channels: string[]; seriesCount: number }[]
}

export interface Download {
  video_id: string
  status: 'queued' | 'downloading' | 'done' | 'error'
  progress: number
  file_path: string | null
  error: string | null
  size_bytes: number | null
  updated_at: string
  title: string
  thumbnail_url: string | null
  channel_id: string
  duration_seconds: number
}

export interface DownloadsResponse {
  ytDlpVersion: string | null
  items: Download[]
}
