import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, qs, type SeriesDetail } from '../api'
import { useApi, useInterval } from '../hooks'
import VideoCard from '../components/VideoCard'
import BackLink from '../components/BackLink'
import { fmtDate } from '../lib/format'
import { cls, Icon, SOURCE_LABEL, Spinner } from '../ui'

export default function SeriesPage() {
  const { seriesId = '' } = useParams()
  if (seriesId === 'new') return <NewSeries />
  return <SeriesDetailPage id={seriesId} />
}

function NewSeries() {
  const [params] = useSearchParams()
  const channelId = params.get('channel') ?? ''
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [pattern, setPattern] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const r = await api<{ id: number }>(`/api/channels/${channelId}/series`, { method: 'POST', json: { name, patterns: pattern ? [pattern] : [] } })
      nav(`/series/${r.id}`, { replace: true })
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-4">
      <BackLink to={`/c/${channelId}`} label="Channel" />
      <form onSubmit={submit} className={`fade-up mt-3 space-y-4 p-6 ${cls.card}`}>
        <div>
          <h1 className="text-xl font-semibold">New series</h1>
          <p className="text-sm text-neutral-500">A title rule fills it automatically; you can also assign videos by hand from their page.</p>
        </div>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required className={`w-full ${cls.input}`} />
        <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Title regex (optional), e.g. happy wheels" className={`w-full font-mono ${cls.input}`} />
        <RulePreview channelId={channelId} pattern={pattern} />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button className={cls.primary}>
          <Icon name="plus" /> Create
        </button>
      </form>
    </div>
  )
}

function RulePreview({ channelId, pattern }: { channelId: string; pattern: string }) {
  const [debounced, setDebounced] = useState(pattern)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(pattern), 300)
    return () => clearTimeout(t)
  }, [pattern])
  const preview = useApi<{ total: number; sample: { id: string; title: string; published_at: string }[] }>(debounced ? `/api/channels/${channelId}/series/preview${qs({ pattern: debounced })}` : null)
  if (!debounced) return null
  if (preview.error) return <p className="text-xs text-red-400">{preview.error}</p>
  if (!preview.data) return null
  return (
    <div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-xs">
      <p className="mb-2 text-neutral-400">
        Matches <b className="text-white">{preview.data.total}</b> titles
      </p>
      <ul className="scroll-thin max-h-40 space-y-0.5 overflow-y-auto">
        {preview.data.sample.map((v) => (
          <li key={v.id} className="truncate text-neutral-300">
            <span className="text-neutral-500">{fmtDate(v.published_at)}</span> {v.title}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SeriesDetailPage({ id }: { id: string }) {
  const nav = useNavigate()
  const s = useApi<SeriesDetail>(`/api/series/${id}`)
  const [newPattern, setNewPattern] = useState('')
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const d = s.data
  const downloading = d?.videos.some((v) => v.download_status === 'queued' || v.download_status === 'downloading') ?? false
  useInterval(s.reload, 3000, downloading)

  async function act(fn: () => Promise<unknown>) {
    setErr(null)
    setBusy(true)
    try {
      await fn()
      s.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (s.error) return <p className="p-8 text-red-400">{s.error}</p>
  if (!d) return null
  const firstUnwatched = d.videos.find((v) => !v.progress_completed)
  const watched = d.videos.filter((v) => v.progress_completed).length
  const onServer = d.videos.filter((v) => v.download_status === 'done').length
  const pending = d.videos.filter((v) => v.download_status === 'queued' || v.download_status === 'downloading').length
  const color = d.color ?? '#525252'

  return (
    <div className="pb-16">
      <div className="relative">
        <div className="absolute inset-0 -z-10 opacity-60" style={{ background: `radial-gradient(800px 320px at 20% 0%, ${color}33, transparent 70%)` }} />
        <div className="mx-auto max-w-screen-xl px-4 pt-3">
          <BackLink to={`/c/${d.channel_id}`} label="Channel" />
          <header className="fade-up flex flex-wrap items-start gap-4 py-5">
            <div className="mt-2 h-10 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-bold tracking-tight">{d.name}</h1>
                <span className={cls.chip}>{SOURCE_LABEL[d.source]}</span>
              </div>
              <p className="mt-1 text-sm text-neutral-400">
                {d.videos.length} episodes
                {d.videos.length > 0 && ` · ${fmtDate(d.videos[0]!.published_at)} – ${fmtDate(d.videos[d.videos.length - 1]!.published_at)}`}
                {watched > 0 && ` · ${watched} watched`}
                {onServer > 0 && (
                  <span className="text-emerald-400">
                    {' '}
                    · {onServer}/{d.videos.length} on server
                  </span>
                )}
              </p>
              {watched > 0 && (
                <div className="mt-2 h-1 w-64 max-w-full rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(100 * watched) / d.videos.length}%` }} />
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {firstUnwatched && (
                <Link to={`/watch/${firstUnwatched.id}`} className={cls.primary}>
                  <Icon name="play" size={14} />
                  {watched > 0 ? 'Continue' : 'Start'} · #{d.videos.indexOf(firstUnwatched) + 1}
                </Link>
              )}
              <button
                disabled={busy || onServer + pending >= d.videos.length}
                onClick={() => act(() => api(`/api/series/${id}/download`, { method: 'POST' }))}
                className={`${cls.btn} ${onServer >= d.videos.length ? 'border-emerald-500/40 text-emerald-300' : ''}`}
                title="Downloads are shared — everyone streams from the server once it's there"
              >
                {pending > 0 ? <Spinner /> : <Icon name={onServer >= d.videos.length ? 'check' : 'download'} />}
                {onServer >= d.videos.length ? 'All on server' : pending > 0 ? `Downloading ${pending}…` : onServer > 0 ? `Download ${d.videos.length - onServer} more` : 'Download all'}
              </button>
              <button onClick={() => setEditing(!editing)} className={cls.btn}>
                <Icon name="settings" /> {editing ? 'Done' : 'Edit'}
              </button>
            </div>
          </header>
        </div>
      </div>

      <div className="mx-auto max-w-screen-xl px-4">
        {editing && (
          <section className={`mb-8 space-y-4 p-4 text-sm ${cls.card}`}>
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2">
                Name
                <input defaultValue={d.name} onBlur={(e) => e.target.value !== d.name && act(() => api(`/api/series/${id}`, { method: 'PUT', json: { name: e.target.value } }))} className={cls.input} />
              </label>
              <label className="flex items-center gap-2">
                Colour
                <input type="color" defaultValue={color} onChange={(e) => act(() => api(`/api/series/${id}`, { method: 'PUT', json: { color: e.target.value } }))} />
              </label>
              <label className="flex items-center gap-2" title="When several series match a title, the highest priority wins">
                Priority
                <input type="number" defaultValue={d.priority} onBlur={(e) => Number(e.target.value) !== d.priority && act(() => api(`/api/series/${id}`, { method: 'PUT', json: { priority: Number(e.target.value) } }))} className={`w-20 ${cls.input}`} />
              </label>
              <button onClick={() => confirm(`Delete series "${d.name}"? Videos stay, just unsorted.`) && act(() => api(`/api/series/${id}`, { method: 'DELETE' })).then(() => nav(`/c/${d.channel_id}`))} className={`ml-auto ${cls.danger}`}>
                <Icon name="trash" size={14} /> Delete series
              </button>
            </div>

            <div>
              <h3 className={`mb-2 ${cls.label}`}>Title rules (regex, case-insensitive)</h3>
              <ul className="space-y-1">
                {d.rules.map((r) => (
                  <li key={r.id} className="flex items-center gap-2">
                    <code className="flex-1 rounded-md bg-black/30 px-2 py-1 font-mono text-xs">
                      /{r.pattern}/{r.flags}
                    </code>
                    <button onClick={() => act(() => api(`/api/rules/${r.id}`, { method: 'DELETE' }))} className={cls.ghost}>
                      <Icon name="x" size={14} />
                    </button>
                  </li>
                ))}
                {d.rules.length === 0 && <li className="text-xs text-neutral-500">No rules — this series only holds videos you assign by hand{d.source === 'playlist' ? ' or that came from the playlist' : ''}.</li>}
              </ul>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  act(() => api(`/api/series/${id}/rules`, { method: 'POST', json: { pattern: newPattern } })).then(() => setNewPattern(''))
                }}
                className="mt-2 flex gap-2"
              >
                <input value={newPattern} onChange={(e) => setNewPattern(e.target.value)} placeholder="new pattern…" className={`flex-1 font-mono ${cls.input}`} />
                <button className={cls.btn}>
                  <Icon name="plus" size={14} /> Add
                </button>
              </form>
              <div className="mt-2">
                <RulePreview channelId={d.channel_id} pattern={newPattern} />
              </div>
            </div>
            {err && <p className="text-red-400">{err}</p>}
          </section>
        )}

        <ol className="grid gap-x-4 gap-y-7 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {d.videos.map((v, i) => (
            <li key={v.id}>
              <VideoCard video={v} episode={i + 1} />
            </li>
          ))}
        </ol>
        {d.videos.length === 0 && <p className="py-16 text-center text-neutral-500">No videos in this series yet. Add a rule, or assign videos from their page.</p>}
      </div>
    </div>
  )
}
