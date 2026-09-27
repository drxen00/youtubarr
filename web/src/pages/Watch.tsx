import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { api, type Series, type SeriesDetail, type Video, type VideoDetail } from '../api'
import { useApi, useInterval, useLocalStorage } from '../hooks'
import { useIsAdmin } from '../auth'
import Player, { type PlayerHandle, type PlayerState } from '../components/Player'
import VideoCard, { SeriesPill } from '../components/VideoCard'
import BackLink from '../components/BackLink'
import { fmtCount, fmtDate, fmtDuration } from '../lib/format'
import { cls, Icon, Spinner } from '../ui'

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
  const downloading = v?.download_status === 'queued' || v?.download_status === 'downloading'
  useInterval(video.reload, 3000, !!downloading)

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
    <div className="mx-auto max-w-screen-2xl lg:flex lg:gap-6 lg:px-4 lg:pb-8">
      {/* ---- main column */}
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-20 bg-neutral-950 lg:static">
          <div className="flex h-11 items-center gap-2 px-2 lg:px-0">
            <BackLink to={`/c/${v.channel_id}`} label={v.channel.title} />
            {v.series_id && v.series_name && (
              <Link to={`/series/${v.series_id}`} className="ml-auto min-w-0">
                <SeriesPill name={`${v.series_name}${v.episode ? ` · ${v.episode.index}/${v.episode.total}` : ''}`} color={v.series_color} />
              </Link>
            )}
          </div>
          <div className="bg-black lg:overflow-hidden lg:rounded-2xl lg:ring-1 lg:ring-white/[0.06]">
            <Player key={`${videoId}-${local}`} ref={player} videoId={videoId} local={local} startAt={startAt} rate={rate} onState={setState} onEnded={onEnded} />
          </div>
        </div>

        {/* ---- chrome: progress + transport */}
        <div className="px-3 pt-3 lg:px-0">
          <div
            className="group relative h-1.5 cursor-pointer rounded-full bg-white/10"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              player.current?.seekTo(((e.clientX - r.left) / r.width) * state.duration)
            }}
          >
            <div className="absolute inset-y-0 left-0 rounded-full bg-white/20" style={{ width: `${bufPct}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${pct}%` }} />
            <div className="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition group-hover:opacity-100" style={{ left: `calc(${pct}% - 6px)` }} />
          </div>

          <div className="mt-2.5 flex items-center gap-0.5">
            <Ctl title="Previous in series (Shift+P)" disabled={!v.prevInSeries} onClick={() => goTo(v.prevInSeries)}>
              <Icon name="skipBack" size={18} />
            </Ctl>
            <Ctl title="Back 10s (J)" onClick={() => player.current?.seekBy(-10)}>
              <Icon name="rewind" size={18} />
            </Ctl>
            <Ctl title="Play/pause (K)" onClick={() => player.current?.toggle()} className="mx-0.5 size-10 rounded-full bg-white text-black hover:bg-neutral-200">
              <Icon name={state.playing ? 'pause' : 'play'} size={18} />
            </Ctl>
            <Ctl title="Forward 10s (L)" onClick={() => player.current?.seekBy(10)}>
              <Icon name="forward" size={18} />
            </Ctl>
            <Ctl title="Next in series (Shift+N)" disabled={!v.nextInSeries} onClick={() => goTo(v.nextInSeries)}>
              <Icon name="skipFwd" size={18} />
            </Ctl>
            <span className="ml-2 text-xs tabular-nums text-neutral-400">
              {fmtDuration(state.position)} <span className="text-neutral-600">/</span> {fmtDuration(state.duration || v.duration_seconds)}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <select value={rate} onChange={(e) => setRate(Number(e.target.value))} className={`${cls.select} py-1 text-xs`} title="Speed">
                {RATES.map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
              <button onClick={() => setAutoplay(!autoplay)} title="Autoplay next episode" className={`rounded-lg px-2 py-1 text-xs font-medium transition ${autoplay ? 'bg-accent text-white' : 'bg-white/5 text-neutral-400 hover:bg-white/10'}`}>
                Auto
              </button>
              {v.localFile && (
                <button
                  onClick={() => setPreferLocal(!preferLocal)}
                  title="Stream from your server (on) or from YouTube (off)"
                  className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium transition ${local ? 'bg-emerald-600 text-white' : 'bg-white/5 text-neutral-400 hover:bg-white/10'}`}
                >
                  <Icon name="server" size={12} /> Server
                </button>
              )}
              <Ctl title="Fullscreen (F)" onClick={() => player.current?.fullscreen()}>
                <Icon name="fullscreen" size={17} />
              </Ctl>
            </div>
          </div>

          {/* ---- older / newer (whole channel) */}
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <button disabled={!v.older} onClick={() => goTo(v.older)} className={`truncate p-3 text-left transition hover:border-white/20 hover:bg-white/[0.05] disabled:opacity-40 ${cls.card}`} title="Older upload ( [ )">
              <span className="flex items-center gap-1 text-neutral-500">
                <Icon name="back" size={12} /> Older · {fmtDate(v.older?.published_at)}
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-neutral-200">{v.older?.title ?? '—'}</span>
            </button>
            <button disabled={!v.newer} onClick={() => goTo(v.newer)} className={`truncate p-3 text-right transition hover:border-white/20 hover:bg-white/[0.05] disabled:opacity-40 ${cls.card}`} title="Newer upload ( ] )">
              <span className="flex items-center justify-end gap-1 text-neutral-500">
                Newer · {fmtDate(v.newer?.published_at)} <Icon name="chevronRight" size={12} />
              </span>
              <span className="mt-0.5 block truncate text-[13px] text-neutral-200">{v.newer?.title ?? '—'}</span>
            </button>
          </div>

          {/* ---- title & meta */}
          <div className="mt-5">
            <h1 className="text-lg font-semibold leading-snug tracking-tight">{v.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-400">
              <Link to={`/c/${v.channel_id}`} className="flex items-center gap-1.5 hover:text-white">
                {v.channel.thumbnail_url && <img src={v.channel.thumbnail_url} alt="" className="size-5 rounded-full" />}
                {v.channel.title}
              </Link>
              <span>· {fmtDate(v.published_at)}</span>
              {v.view_count != null && <span>· {fmtCount(v.view_count)} views</span>}
              <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-white">
                YouTube <Icon name="external" size={11} />
              </a>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <DownloadButton v={v} onChange={video.reload} canDelete={isAdmin} />
              <select
                value={v.series_id ?? ''}
                onChange={(e) => api(`/api/videos/${v.id}/series`, { method: 'PUT', json: { seriesId: e.target.value ? Number(e.target.value) : null } }).then(video.reload)}
                className={`${cls.select} py-1.5 text-xs`}
                title="Which of your series this video belongs to"
              >
                <option value="">— no series —</option>
                {allSeries.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {v.series_source === 'manual' && (
                <button onClick={() => api(`/api/videos/${v.id}/series`, { method: 'DELETE' }).then(video.reload)} className={`${cls.ghost} text-xs`} title="Remove your manual override and let rules decide">
                  <Icon name="x" size={12} /> manual pick
                </button>
              )}
            </div>

            {v.description && (
              <div className="mt-4 text-sm text-neutral-300">
                <p className={showDesc ? 'whitespace-pre-wrap' : 'line-clamp-2 whitespace-pre-wrap'}>{v.description}</p>
                <button onClick={() => setShowDesc(!showDesc)} className="mt-1 text-xs text-neutral-500 hover:text-white">
                  {showDesc ? 'Show less' : 'Show more'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---- sidebar */}
      <aside className="mt-8 px-3 lg:mt-0 lg:w-96 lg:shrink-0 lg:px-0 lg:pt-11">
        <div className="mb-3 flex gap-1 rounded-xl bg-white/5 p-1 text-sm">
          <button onClick={() => setTab('series')} className={`flex-1 truncate rounded-lg py-1.5 transition ${tab === 'series' ? 'bg-white/10 text-white' : 'text-neutral-400 hover:text-white'}`}>
            {v.series_name ?? 'Series'}
          </button>
          <button onClick={() => setTab('timeline')} className={`flex-1 rounded-lg py-1.5 transition ${tab === 'timeline' ? 'bg-white/10 text-white' : 'text-neutral-400 hover:text-white'}`}>
            Around this date
          </button>
        </div>
        {tab === 'series' ? (
          series.data ? (
            <EpisodeList videos={series.data.videos} currentId={v.id} />
          ) : (
            <p className={`p-4 text-sm text-neutral-500 ${cls.card}`}>
              Not in any of your series. Pick one above, or{' '}
              <Link to={`/series/new?channel=${v.channel_id}`} className="underline">
                create one
              </Link>
              .
            </p>
          )
        ) : (
          <Neighbourhood v={v} />
        )}
      </aside>
    </div>
  )
}

function Ctl({ children, className = '', ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} className={`grid size-9 place-items-center rounded-full text-neutral-200 transition hover:bg-white/10 disabled:opacity-30 disabled:hover:bg-transparent ${className}`}>
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
    <ol ref={ref} className="scroll-thin max-h-[70vh] space-y-3 overflow-y-auto pr-1 lg:max-h-[calc(100dvh-8rem)]">
      {videos.map((ep, i) => (
        <li key={ep.id} data-active={ep.id === currentId} className="flex gap-2">
          <span className="w-8 shrink-0 pt-1 text-right text-xs tabular-nums text-neutral-600">{i + 1}</span>
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

function DownloadButton({ v, onChange, canDelete }: { v: VideoDetail; onChange: () => void; canDelete: boolean }) {
  const st = v.download_status
  const shared = 'Shared: once it’s on the server, everyone streams it from there'
  if (st === 'done')
    return canDelete ? (
      <button onClick={() => confirm('Delete the downloaded file from the server? Everyone loses it.') && api(`/api/videos/${v.id}/download`, { method: 'DELETE' }).then(onChange)} className={`${cls.btn} border-emerald-500/40 text-emerald-300`} title="On the server. Click to delete (admin).">
        <Icon name="check" size={14} /> On server
      </button>
    ) : (
      <span className={`${cls.chip} border-emerald-500/30 text-emerald-300`}>
        <Icon name="server" size={12} /> On server
      </span>
    )
  if (st === 'downloading')
    return (
      <span className={`${cls.chip} border-accent/40 text-accent`}>
        <Spinner /> Downloading {Math.round(v.download_progress ?? 0)}%
      </span>
    )
  if (st === 'queued')
    return (
      <span className={cls.chip}>
        <Icon name="clock" size={12} /> Queued
      </span>
    )
  return (
    <button onClick={() => api(`/api/videos/${v.id}/download`, { method: 'POST' }).then(onChange).catch((e: Error) => alert(e.message))} className={cls.primary} title={shared}>
      <Icon name="download" size={14} /> {st === 'error' ? 'Retry download' : 'Download'}
    </button>
  )
}
