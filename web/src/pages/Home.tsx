import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type Channel, type Settings } from '../api'
import { useApi, useInterval } from '../hooks'
import { useIsAdmin } from '../auth'
import { fmtCount, fmtRelative } from '../lib/format'

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
    <div className="mx-auto max-w-screen-2xl px-4 py-6">
      {settings.data && !settings.data.youtubeApiKeySet && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          No YouTube API key yet — indexing channels needs one.{' '}
          <Link to="/settings" className="font-medium underline">
            Add it in Settings
          </Link>
          .
        </div>
      )}

      {isAdmin && (
        <form onSubmit={add} className="mb-8 flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add a channel — @PewDiePie, a channel URL, or a UC… id"
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 outline-none focus:border-accent"
          />
          <button disabled={busy} className="rounded-lg bg-accent px-4 py-2 font-medium text-white disabled:opacity-50">
            {busy ? 'Adding…' : 'Add'}
          </button>
        </form>
      )}
      {error && <p className="-mt-6 mb-6 text-sm text-red-400">{error}</p>}

      {channels.data?.length === 0 && (
        <p className="text-neutral-400">{isAdmin ? 'No channels yet. Add one above — the whole back catalogue gets indexed in the background.' : 'No channels yet — ask an admin to add some.'}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {channels.data?.map((c) => (
          <Link key={c.id} to={`/c/${c.id}`} className="group overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900 transition hover:border-neutral-600">
            <div className="h-20 bg-neutral-800">
              {c.banner_url && <img src={`${c.banner_url}=w1060`} alt="" className="size-full object-cover" />}
            </div>
            <div className="-mt-8 flex items-end gap-3 px-4">
              <img src={c.thumbnail_url ?? ''} alt="" className="size-16 rounded-full border-4 border-neutral-900 bg-neutral-800" />
              <div className="min-w-0 pb-1">
                <h2 className="truncate font-semibold">{c.title}</h2>
                <p className="truncate text-xs text-neutral-400">{c.handle}</p>
              </div>
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-xs text-neutral-400">
              <span>
                {fmtCount(c.indexed_count ?? 0)} videos · {c.series_count ?? 0} series
              </span>
              {c.sync.state === 'running' ? (
                <span className="text-accent">
                  {c.sync.phase === 'organising' ? 'Organising…' : `Indexing ${c.sync.fetched}/${c.sync.total || '?'}`}
                </span>
              ) : c.sync.state === 'error' ? (
                <span className="text-red-400" title={c.sync.error}>
                  Sync failed
                </span>
              ) : (
                <span>{c.last_synced_at ? `Synced ${fmtRelative(c.last_synced_at)}` : 'Not synced'}</span>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
