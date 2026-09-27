import { Link } from 'react-router'
import type { Video } from '../api'
import { fmtCount, fmtDate, fmtDuration } from '../lib/format'
import { Icon } from '../ui'

export function SeriesPill({ name, color, className = '' }: { name: string; color: string | null; className?: string }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${className}`} style={{ background: color ?? '#525252' }}>
      {name}
    </span>
  )
}

export function DownloadBadge({ status, progress }: { status: Video['download_status']; progress: number | null }) {
  if (!status) return null
  if (status === 'done')
    return (
      <span title="On the server — streams from Unraid" className="inline-flex items-center gap-0.5 rounded bg-emerald-500/90 px-1 text-[10px] font-semibold text-white">
        <Icon name="server" size={10} /> LOCAL
      </span>
    )
  if (status === 'downloading') return <span className="rounded bg-accent/90 px-1 text-[10px] font-semibold text-white">{Math.round(progress ?? 0)}%</span>
  if (status === 'queued') return <span className="rounded bg-neutral-700/90 px-1 text-[10px] font-semibold text-white">QUEUED</span>
  return <span className="rounded bg-amber-600/90 px-1 text-[10px] font-semibold text-white">FAILED</span>
}

export default function VideoCard({ video, episode, compact = false, active = false }: { video: Video; episode?: number; compact?: boolean; active?: boolean }) {
  const pct = video.progress_completed ? 100 : video.progress_duration ? Math.min(100, (100 * (video.progress_position ?? 0)) / video.progress_duration) : 0

  const thumb = (
    <div className={`relative overflow-hidden rounded-xl bg-neutral-900 ring-1 ring-white/[0.06] ${compact ? 'w-40 shrink-0' : ''} aspect-video`}>
      {video.thumbnail_url && <img src={video.thumbnail_url} alt="" loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
      <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-medium tabular-nums">{fmtDuration(video.duration_seconds)}</span>
      {episode != null && <span className="absolute left-1.5 top-1.5 rounded-md bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold">#{episode}</span>}
      <span className="absolute right-1.5 top-1.5">
        <DownloadBadge status={video.download_status} progress={video.download_progress} />
      </span>
      {video.progress_completed ? (
        <span className="absolute bottom-1.5 left-1.5 grid size-5 place-items-center rounded-full bg-emerald-500 text-white">
          <Icon name="check" size={11} />
        </span>
      ) : null}
      {pct > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )

  return (
    <Link to={`/watch/${video.id}`} className={`group flex ${compact ? 'gap-3' : 'flex-col gap-2.5'} ${active ? '-m-1.5 rounded-xl bg-white/[0.06] p-1.5' : ''}`}>
      {thumb}
      <div className="min-w-0">
        <h3 className={`line-clamp-2 text-[13.5px] font-medium leading-snug ${active ? 'text-accent' : 'text-neutral-100'}`}>{video.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-neutral-500">
          <span>{fmtDate(video.published_at)}</span>
          {video.view_count != null && <span>· {fmtCount(video.view_count)} views</span>}
          {!compact && video.series_name && <SeriesPill name={video.series_name} color={video.series_color} />}
        </div>
      </div>
    </Link>
  )
}
