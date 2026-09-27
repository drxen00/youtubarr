import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type Channel, type Settings } from '../api'
import { useApi, useInterval } from '../hooks'
import { useIsAdmin } from '../auth'
import { fmtCount, fmtRelative } from '../lib/format'
import { cls, Icon, Spinner } from '../ui'

export default function Home() {
  const isAdmin = useIsAdmin()
  const channels = useApi<Channel[]>('/api/channels')
  const settings = useApi<Settings>(isAdmin ? '/api/settings' : null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const syncing = channels.data?.some((c) => c.sync.state === 'running') ?? false
  useInterval(channels.reload, 2000, syncing)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!input.trim()) return
    setBusy(true)
    setError(null)
    try {
      await api('/api/channels', { method: 'POST', json: { input } })
      setInput('')
      channels.reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8">
      {settings.data && !settings.data.youtubeApiKeySet && (
        <div className="mb-6 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <Icon name="key" className="shrink-0 text-amber-400" />
          <span>
            No YouTube API key yet — indexing channels needs one.{' '}
            <Link to="/settings" className="font-medium underline">
              Add it in Settings
            </Link>
            .
          </span>
        </div>
      )}

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Channels</h1>
          <p className="text-sm text-neutral-500">Shared library. Series and watch history are yours.</p>
        </div>
        <form onSubmit={add} className="flex w-full gap-2 sm:w-auto">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="@PewDiePie, a channel URL, or UC… id" className={`w-full sm:w-80 ${cls.input}`} />
          <button disabled={busy} className={cls.primary}>
            {busy ? <Spinner /> : <Icon name="plus" />}
            Add
          </button>
        </form>
      </div>
      {error && <p className="-mt-4 mb-6 text-sm text-red-400">{error}</p>}

      {channels.data?.length === 0 && (
        <div className={`grid place-items-center p-12 text-center ${cls.card}`}>
          <Icon name="film" size={36} className="mb-3 text-neutral-600" />
          <p className="font-medium">No channels yet</p>
          <p className="mt-1 max-w-sm text-sm text-neutral-500">Add a creator above. The whole back catalogue gets indexed in the background, then you choose how to sort it into series.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {channels.data?.map((c, i) => (
          <Link
            key={c.id}
            to={`/c/${c.id}`}
            className={`fade-up group overflow-hidden ${cls.card} transition hover:-translate-y-0.5 hover:border-white/20 hover:shadow-xl hover:shadow-black/40`}
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <div className="relative h-24 bg-neutral-900">
              {c.banner_url && <img src={`${c.banner_url}=w1060`} alt="" className="size-full object-cover opacity-80 transition group-hover:opacity-100" />}
              <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 to-transparent" />
            </div>
            {/* relative: the banner above is positioned, so without this it paints over the avatar's top half */}
            <div className="relative -mt-9 flex items-end gap-3 px-4">
              <img src={c.thumbnail_url ?? ''} alt="" className="size-[68px] rounded-full bg-neutral-800 ring-4 ring-neutral-950" />
              <div className="min-w-0 pb-1">
                <h2 className="truncate font-semibold">{c.title}</h2>
                <p className="truncate text-xs text-neutral-500">{c.handle}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 pb-4 pt-3 text-xs text-neutral-400">
              <span>{fmtCount(c.indexed_count ?? 0)} videos</span>
              <span>{c.series_count ?? 0} series</span>
              {(c.downloaded_count ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <Icon name="server" size={12} /> {c.downloaded_count}
                </span>
              )}
              <span className="ml-auto">
                {c.sync.state === 'running' ? (
                  <span className="inline-flex items-center gap-1.5 text-accent">
                    <Spinner /> {c.sync.phase === 'organising' ? 'Organising' : `${c.sync.fetched}/${c.sync.total || '?'}`}
                  </span>
                ) : c.sync.state === 'error' ? (
                  <span className="text-red-400" title={c.sync.error}>
                    Sync failed
                  </span>
                ) : !c.organised ? (
                  <span className="rounded-full bg-accent/15 px-2 py-0.5 font-medium text-accent">Set up series</span>
                ) : (
                  <span>{c.last_synced_at ? fmtRelative(c.last_synced_at) : 'Not synced'}</span>
                )}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
