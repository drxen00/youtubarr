import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { api, type Series } from '../api'
import { cls, Icon, Spinner } from '../ui'

/**
 * The "Download" button on a channel: queue a whole playlist or series for yt-dlp. Files are shared —
 * once one person has a video on the server, everyone streams it from there.
 */
export default function DownloadMenu({ series, onChange }: { series: Series[]; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  async function queue(s: Series) {
    setBusy(s.id)
    setMsg(null)
    try {
      const r = await api<{ queued: number }>(`/api/series/${s.id}/download`, { method: 'POST' })
      setMsg(r.queued ? `Queued ${r.queued} videos from “${s.name}”.` : `“${s.name}” is already fully on the server.`)
      onChange()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const playlists = series.filter((s) => s.source === 'playlist' && s.video_count > 0)
  const mine = series.filter((s) => s.source !== 'playlist' && s.video_count > 0)

  const Row = ({ s }: { s: Series }) => {
    const done = s.downloaded_count >= s.video_count
    return (
      <li className="flex items-center gap-3 px-3 py-2 hover:bg-white/[0.04]">
        <span className="size-2 shrink-0 rounded-full" style={{ background: s.color ?? '#525252' }} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{s.name}</span>
          <span className="block text-[11px] text-neutral-500">
            {s.downloaded_count}/{s.video_count} on server
          </span>
        </span>
        <button onClick={() => queue(s)} disabled={busy !== null || done} className={`${done ? cls.ghost : cls.btn} shrink-0 py-1 text-xs`}>
          {busy === s.id ? <Spinner /> : done ? <Icon name="check" size={13} /> : <Icon name="download" size={13} />}
          {done ? 'Complete' : `Get ${s.video_count - s.downloaded_count}`}
        </button>
      </li>
    )
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className={cls.primary}>
        <Icon name="download" />
        Download
        <Icon name="chevronDown" size={14} className={`transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className={`fade-up absolute right-0 z-40 mt-2 w-80 overflow-hidden ${cls.card} bg-neutral-950/95 shadow-2xl shadow-black/60 backdrop-blur-xl`}>
          <div className="border-b border-white/[0.06] px-3 py-2.5 text-xs leading-relaxed text-neutral-400">
            Downloads land on the Unraid box and are <b className="text-neutral-200">shared</b>: once a video is there, everyone streams it from your server instead of YouTube.
          </div>
          <div className="scroll-thin max-h-96 overflow-y-auto">
            {playlists.length > 0 && (
              <>
                <div className={`px-3 pb-1 pt-2.5 ${cls.label}`}>Playlists</div>
                <ul>
                  {playlists.map((s) => (
                    <Row key={s.id} s={s} />
                  ))}
                </ul>
              </>
            )}
            {mine.length > 0 && (
              <>
                <div className={`px-3 pb-1 pt-2.5 ${cls.label}`}>Series</div>
                <ul>
                  {mine.map((s) => (
                    <Row key={s.id} s={s} />
                  ))}
                </ul>
              </>
            )}
            {playlists.length + mine.length === 0 && <p className="px-3 py-4 text-sm text-neutral-500">Set up some series first — then you can grab whole ones here. Single videos have a Download button on their page.</p>}
          </div>
          <div className="flex items-center justify-between border-t border-white/[0.06] px-3 py-2 text-xs">
            <span className="text-neutral-400">{msg ?? 'One at a time, in order.'}</span>
            <Link to="/settings#downloads" className="text-neutral-300 hover:text-white">
              Queue →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
