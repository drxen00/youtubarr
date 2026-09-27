import { Link } from 'react-router'
import type { Video } from '../api'
import { fmtCount, fmtDate, fmtDuration } from '../lib/format'

export function SeriesPill({ name, color, className = '' }: { name: string; color: string | null; className?: string }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[11px] font-medium text-white ${className}`}
      style={{ background: color ?? '#525252' }}
    >
      {name}
    </span>
  )
}

export default function VideoCard({
  video,
  episode,
  compact = false,
  active = false,
}: {
  video: Video
  episode?: number
  compact?: boolean
  active?: boolean
}) {
  const pct =
    video.progress_completed ? 100 : video.progress_duration ? Math.min(100, (100 * (video.progress_position ?? 0)) / video.progress_duration) : 0

  const thumb = (
    <div className={`relative overflow-hidden rounded-lg bg-neutral-800 ${compact ? 'w-40 shrink-0' : ''} aspect-video`}>
      {video.thumbnail_url && (
        <img src={video.thumbnail_url} alt="" loading="lazy" className="size-full object-cover transition group-hover:scale-[1.03]" />
      )}
      <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[11px] font-medium tabular-nums">{fmtDuration(video.duration_seconds)}</span>
      {episode != null && <span className="absolute left-1 top-1 rounded bg-black/80 px-1.5 text-[11px] font-semibold">#{episode}</span>}
      {video.download_status === 'done' && (
        <span title="Downloaded" className="absolute right-1 top-1 rounded bg-emerald-600/90 px-1 text-[10px] font-semibold">LOCAL</span>
      )}
      {pct > 0 && (
        <div className="absolute inset-x-0 bottom-0 h-1 bg-white/20">
          <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )

  return (
    <Link to={`/watch/${video.id}`} className={`group flex ${compact ? 'gap-3' : 'flex-col gap-2'} ${active ? 'rounded-lg bg-neutral-800/70 p-1 -m-1' : ''}`}>
      {thumb}
      <div className="min-w-0">
        <h3 className={`line-clamp-2 text-sm font-medium leading-snug ${active ? 'text-accent' : ''}`}>{video.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
          <span>{fmtDate(video.published_at)}</span>
          {video.view_count != null && <span>· {fmtCount(video.view_count)} views</span>}
          {!compact && video.series_name && <SeriesPill name={video.series_name} color={video.series_color} />}
        </div>
      </div>
    </Link>
  )
}
