import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { api, qs, type Series, type SeriesDetail } from '../api'
import { useApi } from '../hooks'
import { useIsAdmin } from '../auth'
import VideoCard from '../components/VideoCard'
import { fmtDate } from '../lib/format'

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
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-4 px-4 py-8">
      <h1 className="text-xl font-semibold">New series</h1>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-accent" />
      <input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="Title regex (optional), e.g. happy wheels" className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm outline-none focus:border-accent" />
      <RulePreview channelId={channelId} pattern={pattern} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      <button className="rounded-lg bg-accent px-4 py-2 font-medium text-white">Create</button>
    </form>
  )
}

function RulePreview({ channelId, pattern }: { channelId: string; pattern: string }) {
  const [debounced, setDebounced] = useState(pattern)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(pattern), 300)
    return () => clearTimeout(t)
  }, [pattern])
  const preview = useApi<{ total: number; sample: { id: string; title: string; published_at: string; series_id: number | null }[] }>(
    debounced ? `/api/channels/${channelId}/series/preview${qs({ pattern: debounced })}` : null,
  )
  if (!debounced) return null
  if (preview.error) return <p className="text-xs text-red-400">{preview.error}</p>
  if (!preview.data) return null
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-3 text-xs">
      <p className="mb-2 text-neutral-400">
        Matches <b className="text-white">{preview.data.total}</b> titles
      </p>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto">
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
  const isAdmin = useIsAdmin()
  const s = useApi<SeriesDetail>(`/api/series/${id}`)
  const [newPattern, setNewPattern] = useState('')
  const [editing, setEditing] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const siblings = useApi<Series[]>(s.data ? `/api/channels/${s.data.channel_id}/series` : null)

  async function act(fn: () => Promise<unknown>) {
    setErr(null)
    try {
      await fn()
      s.reload()
      siblings.reload()
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  if (s.error) return <p className="p-8 text-red-400">{s.error}</p>
  const d = s.data
  if (!d) return null
  const firstUnwatched = d.videos.find((v) => !v.progress_completed)
  const watched = d.videos.filter((v) => v.progress_completed).length

  return (
    <div className="mx-auto max-w-screen-xl px-4 pb-16">
      <header className="flex flex-wrap items-start gap-4 py-6">
        <div className="mt-1 size-3 shrink-0 rounded-full" style={{ background: d.color ?? '#525252' }} />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-neutral-400">
            <Link to={`/c/${d.channel_id}`} className="hover:text-white">
              ← Channel
            </Link>
          </p>
          <h1 className="text-2xl font-bold">{d.name}</h1>
          <p className="text-sm text-neutral-400">
            {d.videos.length} episodes
            {d.videos.length > 0 && ` · ${fmtDate(d.videos[0]!.published_at)} – ${fmtDate(d.videos[d.videos.length - 1]!.published_at)}`}
            {watched > 0 && ` · ${watched} watched`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {firstUnwatched && (
            <Link to={`/watch/${firstUnwatched.id}`} className="rounded-lg bg-accent px-4 py-1.5 font-medium text-white">
              {watched > 0 ? 'Continue' : 'Start'} · #{d.videos.indexOf(firstUnwatched) + 1}
            </Link>
          )}
          {isAdmin && (
            <button onClick={() => setEditing(!editing)} className="rounded-lg border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800">
              {editing ? 'Done' : 'Edit rules'}
            </button>
          )}
        </div>
      </header>

      {editing && (
        <section className="mb-8 space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Name
              <input
                defaultValue={d.name}
                onBlur={(e) => e.target.value !== d.name && act(() => api(`/api/series/${id}`, { method: 'PUT', json: { name: e.target.value } }))}
                className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2">
              Colour
              <input type="color" defaultValue={d.color ?? '#525252'} onChange={(e) => act(() => api(`/api/series/${id}`, { method: 'PUT', json: { color: e.target.value } }))} />
            </label>
            <label className="flex items-center gap-2" title="When several series match a title, the highest priority wins">
              Priority
              <input
                type="number"
                defaultValue={d.priority}
                onBlur={(e) => Number(e.target.value) !== d.priority && act(() => api(`/api/series/${id}`, { method: 'PUT', json: { priority: Number(e.target.value) } }))}
                className="w-20 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1"
              />
            </label>
            <button
              onClick={() => confirm(`Delete series "${d.name}"? Videos stay, just unsorted.`) && act(() => api(`/api/series/${id}`, { method: 'DELETE' })).then(() => nav(`/c/${d.channel_id}`))}
              className="ml-auto text-red-400 hover:text-red-300"
            >
              Delete series
            </button>
          </div>

          <div>
            <h3 className="mb-2 font-medium">Title rules (regex, case-insensitive)</h3>
            <ul className="space-y-1">
              {d.rules.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-neutral-950 px-2 py-1 font-mono text-xs">
                    /{r.pattern}/{r.flags}
                  </code>
                  <button onClick={() => act(() => api(`/api/rules/${r.id}`, { method: 'DELETE' }))} className="text-neutral-400 hover:text-red-400">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                act(() => api(`/api/series/${id}/rules`, { method: 'POST', json: { pattern: newPattern } })).then(() => setNewPattern(''))
              }}
              className="mt-2 flex gap-2"
            >
              <input
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                placeholder="new pattern…"
                className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 font-mono text-xs"
              />
              <button className="rounded-md bg-neutral-700 px-3 py-1 hover:bg-neutral-600">Add</button>
            </form>
            <div className="mt-2">
              <RulePreview channelId={d.channel_id} pattern={newPattern} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-neutral-800 pt-3">
            <button
              onClick={() => confirm(`Queue all ${d.videos.length} episodes for download?`) && act(() => api(`/api/series/${id}/download`, { method: 'POST' }))}
              className="rounded-md border border-neutral-700 px-3 py-1 hover:bg-neutral-800"
            >
              Download all episodes
            </button>
            <span className="text-xs text-neutral-500">Downloads run one at a time via yt-dlp. Track them in Settings.</span>
          </div>
          {err && <p className="text-red-400">{err}</p>}
        </section>
      )}

      <ol className="grid gap-x-4 gap-y-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {d.videos.map((v, i) => (
          <li key={v.id}>
            <VideoCard video={v} episode={i + 1} />
          </li>
        ))}
      </ol>
      {d.videos.length === 0 && <p className="py-10 text-center text-neutral-500">No videos in this series yet.{isAdmin && ' Add a rule above.'}</p>}
    </div>
  )
}
