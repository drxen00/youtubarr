import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, type Series, type SeriesDetail, type Video, type VideoDetail } from '../api'
import { useApi, useLocalStorage } from '../hooks'
import { useIsAdmin } from '../auth'
import Player, { type PlayerHandle, type PlayerState } from '../components/Player'
import VideoCard, { SeriesPill } from '../components/VideoCard'
import { fmtCount, fmtDate, fmtDuration } from '../lib/format'

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2]

export default function WatchPage() {
  const { videoId = '' } = useParams()
  const nav = useNavigate()
  const isAdmin = useIsAdmin()
  const video = useApi<VideoDetail>(`/api/videos/${videoId}`)
  const v = video.data
  const series = useApi<SeriesDetail>(v?.series_id ? `/api/series/${v.series_id}` : null)
  const allSeries = useApi<Series[]>(v ? `/api/channels/${v.channel_id}/series` : null)

  const player = useRef<PlayerHandle>(null)
  const [state, setState] = useState<PlayerState>({ position: 0, duration: 0, playing: false, buffered: 0 })
  const [rate, setRate] = useLocalStorage('rate', 1)
  const [autoplay, setAutoplay] = useLocalStorage('autoplay', true)
  const [preferLocal, setPreferLocal] = useLocalStorage('preferLocal', true)
  const [tab, setTab] = useState<'series' | 'timeline'>('series')
  const [showDesc, setShowDesc] = useState(false)
  const lastSaved = useRef(0)

  const local = !!v?.localFile && preferLocal
  const startAt = v && !v.progress_completed && (v.progress_position ?? 0) > 20 ? v.progress_position! : 0

  // Save progress every 5s while playing, and once on unmount.
  const save = useCallback(
    (pos: number, dur: number, completed?: boolean) => {
      if (!videoId || dur <= 0) return
      void api(`/api/videos/${videoId}/progress`, { method: 'PUT', json: { position: pos, duration: dur, completed } }).catch(() => {})
    },
    [videoId],
  )
  const stateRef = useRef(state)
  stateRef.current = state
  useEffect(() => {
    if (state.playing && Date.now() - lastSaved.current > 5000) {
      lastSaved.current = Date.now()
      save(state.position, state.duration)
    }
  }, [state, save])
  useEffect(() => () => save(stateRef.current.position, stateRef.current.duration), [videoId, save])

  const goTo = useCallback(
    (target: Video | null | undefined) => {
      if (target) nav(`/watch/${target.id}`)
    },
    [nav],
  )

  const onEnded = useCallback(() => {
    save(stateRef.current.duration, stateRef.current.duration, true)
    if (autoplay && v?.nextInSeries) goTo(v.nextInSeries)
  }, [autoplay, v, goTo, save])

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
      const p = player.current
      if (!p) return
      const k = e.key
      if (k === ' ' || k === 'k') p.toggle()
      else if (k === 'j') p.seekBy(-10)
      else if (k === 'l') p.seekBy(10)
      else if (k === 'ArrowLeft') p.seekBy(e.shiftKey ? -60 : -5)
      else if (k === 'ArrowRight') p.seekBy(e.shiftKey ? 60 : 5)
      else if (k === 'f') p.fullscreen()
      else if (k === 'm') p.toggleMute()
      else if (k === 'N') goTo(v?.nextInSeries)
      else if (k === 'P') goTo(v?.prevInSeries)
      else if (k === ']') goTo(v?.newer)
      else if (k === '[') goTo(v?.older)
      else if (/^[0-9]$/.test(k) && stateRef.current.duration) p.seekTo((Number(k) / 10) * stateRef.current.duration)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [v, goTo])

  useEffect(() => {
    if (v) document.title = `${v.title} · youtubarr`
    return () => {
      document.title = 'youtubarr'
    }
  }, [v])

  if (video.error) return <p className="p-8 text-red-400">{video.error}</p>
  if (!v) return <div className="aspect-video w-full bg-black" />

  const pct = state.duration ? (100 * state.position) / state.duration : 0
  const bufPct = state.duration ? (100 * state.buffered) / state.duration : 0

  return (
    <div className="mx-auto max-w-screen-2xl lg:flex lg:gap-6 lg:px-4 lg:py-4">
      {/* ---- main column */}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 bg-black lg:static lg:overflow-hidden lg:rounded-xl">
          <Player key={`${videoId}-${local}`} ref={player} videoId={videoId} local={local} startAt={startAt} rate={rate} onState={setState} onEnded={onEnded} />
        </div>

        {/* ---- our chrome: progress + transport */}
        <div className="bg-neutral-950 px-3 pt-2 lg:px-0">
          <div
            className="group relative h-1.5 cursor-pointer rounded-full bg-neutral-800"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              player.current?.seekTo(((e.clientX - r.left) / r.width) * state.duration)
            }}
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-neutral-600" style={{ width: `${bufPct}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2 flex items-center gap-1 text-sm">
            <NavBtn title="Previous in series (Shift+P)" disabled={!v.prevInSeries} onClick={() => goTo(v.prevInSeries)}>
              ⏮
            </NavBtn>
            <NavBtn title="Back 10s (J)" onClick={() => player.current?.seekBy(-10)}>
              ↺10
            </NavBtn>
            <NavBtn title="Play/pause (K)" onClick={() => player.current?.toggle()} className="min-w-10 text-lg">
              {state.playing ? '❚❚' : '▶'}
            </NavBtn>
            <NavBtn title="Forward 10s (L)" onClick={() => player.current?.seekBy(10)}>
              10↻
            </NavBtn>
            <NavBtn title="Next in series (Shift+N)" disabled={!v.nextInSeries} onClick={() => goTo(v.nextInSeries)}>
              ⏭
            </NavBtn>
            <span className="ml-2 tabular-nums text-xs text-neutral-400">
              {fmtDuration(state.position)} / {fmtDuration(state.duration || v.duration_seconds)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <select value={rate} onChange={(e) => setRate(Number(e.target.value))} className="rounded-md bg-neutral-800 px-1.5 py-1 text-xs" title="Speed">
                {RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
              <button
                onClick={() => setAutoplay(!autoplay)}
                title="Autoplay next episode"
                className={`rounded-md px-2 py-1 text-xs ${autoplay ? 'bg-accent text-white' : 'bg-neutral-800 text-neutral-300'}`}
              >
                Auto
              </button>
              {v.localFile && (
                <button
                  onClick={() => setPreferLocal(!preferLocal)}
                  title="Toggle between the downloaded file and the YouTube embed"
                  className={`rounded-md px-2 py-1 text-xs ${local ? 'bg-emerald-600 text-white' : 'bg-neutral-800 text-neutral-300'}`}
                >
                  Local
                </button>
              )}
              <NavBtn title="Fullscreen (F)" onClick={() => player.current?.fullscreen()}>
                ⛶
              </NavBtn>
            </div>
          </div>

          {/* ---- older / newer (whole channel) */}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <button
              disabled={!v.older}
              onClick={() => goTo(v.older)}
              className="truncate rounded-lg border border-neutral-800 px-3 py-2 text-left hover:bg-neutral-900 disabled:opacity-40"
              title="Older upload ( [ )"
            >
              <span className="text-neutral-500">← Older · {fmtDate(v.older?.published_at)}</span>
              <div className="truncate">{v.older?.title ?? '—'}</div>
            </button>
            <button
              disabled={!v.newer}
              onClick={() => goTo(v.newer)}
              className="truncate rounded-lg border border-neutral-800 px-3 py-2 text-right hover:bg-neutral-900 disabled:opacity-40"
              title="Newer upload ( ] )"
            >
              <span className="text-neutral-500">Newer · {fmtDate(v.newer?.published_at)} →</span>
              <div className="truncate">{v.newer?.title ?? '—'}</div>
            </button>
          </div>

          {/* ---- title & meta */}
          <div className="mt-4">
            <h1 className="text-lg font-semibold leading-snug">{v.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
              <Link to={`/c/${v.channel_id}`} className="flex items-center gap-1.5 hover:text-white">
                {v.channel.thumbnail_url && <img src={v.channel.thumbnail_url} alt="" className="size-5 rounded-full" />}
                {v.channel.title}
              </Link>
              <span>· {fmtDate(v.published_at)}</span>
              {v.view_count != null && <span>· {fmtCount(v.view_count)} views</span>}
              {v.series_id && v.series_name && (
                <Link to={`/series/${v.series_id}`}>
                  <SeriesPill name={`${v.series_name}${v.episode ? ` · ${v.episode.index}/${v.episode.total}` : ''}`} color={v.series_color} />
                </Link>
              )}
              {isAdmin && (
                <>
                  <select
                    value={v.series_id ?? ''}
                    onChange={(e) =>
                      api(`/api/videos/${v.id}/series`, { method: 'PUT', json: { seriesId: e.target.value ? Number(e.target.value) : null } }).then(video.reload)
                    }
                    className="rounded-md bg-neutral-800 px-1.5 py-0.5 text-xs"
                    title="Assign this video to a series"
                  >
                    <option value="">— no series —</option>
                    {allSeries.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {v.series_manual === 1 && (
                    <button onClick={() => api(`/api/videos/${v.id}/series`, { method: 'DELETE' }).then(video.reload)} className="underline" title="Remove manual override">
                      manual
                    </button>
                  )}
                  <DownloadButton v={v} onChange={video.reload} />
                </>
              )}
              <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="hover:text-white">
                YouTube ↗
              </a>
            </div>
            {v.description && (
              <div className="mt-3 text-sm text-neutral-300">
                <p className={showDesc ? 'whitespace-pre-wrap' : 'line-clamp-2 whitespace-pre-wrap'}>{v.description}</p>
                <button onClick={() => setShowDesc(!showDesc)} className="mt-1 text-xs text-neutral-400 hover:text-white">
                  {showDesc ? 'Show less' : 'Show more'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- sidebar: series episodes / channel timeline */}
      <aside className="mt-6 px-3 lg:mt-0 lg:w-96 lg:shrink-0 lg:px-0">
        <div className="mb-3 flex gap-1 rounded-lg bg-neutral-900 p-1 text-sm">
          <button onClick={() => setTab('series')} className={`flex-1 rounded-md py-1.5 ${tab === 'series' ? 'bg-neutral-700' : 'text-neutral-400'}`}>
            {v.series_name ?? 'Series'}
          </button>
          <button onClick={() => setTab('timeline')} className={`flex-1 rounded-md py-1.5 ${tab === 'timeline' ? 'bg-neutral-700' : 'text-neutral-400'}`}>
            Around this date
          </button>
        </div>
        {tab === 'series' ? (
          series.data ? (
            <EpisodeList videos={series.data.videos} currentId={v.id} />
          ) : (
            <p className="text-sm text-neutral-500">
              Not part of a series.{isAdmin && <> Assign one above, or <Link to={`/series/new?channel=${v.channel_id}`} className="underline">create one</Link>.</>}
            </p>
          )
        ) : (
          <Neighbourhood v={v} />
        )}
      </aside>
    </div>
  )
}

function NavBtn({ children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`rounded-md px-2.5 py-1.5 hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-transparent ${className}`}>
      {children}
    </button>
  )
}

function EpisodeList({ videos, currentId }: { videos: Video[]; currentId: string }) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'center' })
  }, [currentId, videos.length])
  return (
    <ol ref={ref} className="max-h-[70vh] space-y-3 overflow-y-auto pr-1 lg:max-h-[calc(100dvh-8rem)]">
      {videos.map((ep, i) => (
        <li key={ep.id} data-active={ep.id === currentId} className="flex gap-2">
          <span className="w-8 shrink-0 pt-1 text-right text-xs tabular-nums text-neutral-500">{i + 1}</span>
          <div className="min-w-0 flex-1">
            <VideoCard video={ep} compact active={ep.id === currentId} />
          </div>
        </li>
      ))}
    </ol>
  )
}

/** Uploads immediately around the current one, for browsing by era rather than series. */
function Neighbourhood({ v }: { v: VideoDetail }) {
  const day = 86400_000
  const from = new Date(new Date(v.published_at).getTime() - 30 * day).toISOString()
  const to = new Date(new Date(v.published_at).getTime() + 30 * day).toISOString()
  const list = useApi<{ items: Video[] }>(`/api/channels/${v.channel_id}/videos?from=${from}&to=${to}&sort=oldest&limit=200`)
  return list.data ? <EpisodeList videos={list.data.items} currentId={v.id} /> : null
}

function DownloadButton({ v, onChange }: { v: VideoDetail; onChange: () => void }) {
  const st = v.download_status
  if (st === 'done')
    return (
      <button onClick={() => confirm('Delete the downloaded file?') && api(`/api/videos/${v.id}/download`, { method: 'DELETE' }).then(onChange)} className="text-emerald-400 hover:text-emerald-300">
        Downloaded ✓
      </button>
    )
  if (st === 'downloading') return <span className="text-accent">Downloading {Math.round(v.download_progress ?? 0)}%</span>
  if (st === 'queued') return <span className="text-neutral-400">Queued…</span>
  return (
    <button
      onClick={() =>
        api(`/api/videos/${v.id}/download`, { method: 'POST' })
          .then(onChange)
          .catch((e: Error) => alert(e.message))
      }
      className="hover:text-white"
    >
      {st === 'error' ? 'Retry download' : 'Download'}
    </button>
  )
}
