import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api, qs, type Channel, type Page, type Series, type Video } from '../api'
import { useApi, useInterval } from '../hooks'
import Timeline, { type Bucket } from '../components/Timeline'
import VideoCard from '../components/VideoCard'
import Organise from '../components/Organise'
import { fmtCount, fmtRelative } from '../lib/format'

const PAGE = 60

export default function ChannelPage() {
  const { channelId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const series = params.get('series') ?? ''
  const q = params.get('q') ?? ''
  const from = params.get('from') // YYYY-MM
  const sort = params.get('sort') ?? (from ? 'oldest' : 'newest')
  const [offset, setOffset] = useState(0)
  const [items, setItems] = useState<Video[]>([])
  const [search, setSearch] = useState(q)

  const channel = useApi<Channel>(`/api/channels/${channelId}`)
  const seriesList = useApi<Series[]>(`/api/channels/${channelId}/series`)
  const timeline = useApi<Bucket[]>(`/api/channels/${channelId}/timeline${qs({ series })}`)
  const cont = useApi<Video[]>(`/api/channels/${channelId}/continue`)

  const syncing = channel.data?.sync.state === 'running'
  useInterval(() => {
    channel.reload()
    seriesList.reload()
    timeline.reload()
  }, 3000, !!syncing)

  const listPath = useMemo(
    () => `/api/channels/${channelId}/videos${qs({ series, q, from: from ? `${from}-01` : undefined, sort, limit: PAGE, offset })}`,
    [channelId, series, q, from, sort, offset],
  )
  const page = useApi<Page<Video>>(listPath)

  useEffect(() => {
    setOffset(0)
    setItems([])
  }, [channelId, series, q, from, sort])
  useEffect(() => {
    if (page.data) setItems((prev) => (page.data!.offset === 0 ? page.data!.items : [...prev, ...page.data!.items]))
  }, [page.data])

  function set(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) v ? next.set(k, v) : next.delete(k)
    setParams(next, { replace: true })
  }

  useEffect(() => {
    const t = setTimeout(() => {
      if (search !== q) set({ q: search || null })
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const c = channel.data
  const total = page.data?.total ?? 0

  return (
    <div className="mx-auto max-w-screen-2xl px-4 pb-16">
      {c && (
        <header className="flex flex-wrap items-center gap-4 py-6">
          <img src={c.thumbnail_url ?? ''} alt="" className="size-16 rounded-full bg-neutral-800 sm:size-20" />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">{c.title}</h1>
            <p className="text-sm text-neutral-400">
              {c.handle} · {fmtCount(c.video_count)} videos
              {c.subscriber_count != null && ` · ${fmtCount(c.subscriber_count)} subscribers`}
            </p>
            <p className="mt-1 text-xs text-neutral-500">
              {syncing ? (
                <span className="text-accent">
                  {c.sync.phase === 'organising' ? 'Organising into series…' : `Indexing ${c.sync.fetched}/${c.sync.total || '?'}…`}
                </span>
              ) : c.sync.state === 'error' ? (
                <span className="text-red-400">Sync failed: {c.sync.error}</span>
              ) : c.last_synced_at ? (
                `Synced ${fmtRelative(c.last_synced_at)}`
              ) : (
                'Not synced yet'
              )}
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <button
              disabled={syncing}
              onClick={() => api(`/api/channels/${channelId}/sync`, { method: 'POST', json: {} }).then(channel.reload)}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-50"
            >
              Check for new
            </button>
            <button
              disabled={syncing}
              onClick={() => confirm('Re-fetch every video? Uses ~2 API units per 50 videos.') && api(`/api/channels/${channelId}/sync`, { method: 'POST', json: { full: true } }).then(channel.reload)}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-50"
            >
              Full resync
            </button>
          </div>
        </header>
      )}

      {cont.data && cont.data.length > 0 && !series && !q && !from && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neutral-400">Continue watching</h2>
          <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4">
            {cont.data.map((v) => (
              <div key={v.id} className="w-64 shrink-0">
                <VideoCard video={v} />
              </div>
            ))}
          </div>
        </section>
      )}

      {seriesList.data && seriesList.data.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Series</h2>
            <Link to={`/series/new?channel=${channelId}`} className="text-xs text-neutral-400 hover:text-white">
              + New series
            </Link>
          </div>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
            {seriesList.data
              .filter((s) => s.video_count > 0)
              .map((s) => (
                <Link
                  key={s.id}
                  to={`/series/${s.id}`}
                  className="group relative w-44 shrink-0 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 transition hover:border-neutral-600"
                >
                  <div className="aspect-video bg-neutral-800">
                    {s.thumbnail_url && <img src={s.thumbnail_url} alt="" loading="lazy" className="size-full object-cover" />}
                  </div>
                  <div className="absolute inset-x-0 top-0 h-1" style={{ background: s.color ?? '#525252' }} />
                  <div className="p-2">
                    <div className="truncate text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-neutral-400">
                      {s.video_count} eps{s.watched_count > 0 && ` · ${s.watched_count} watched`}
                    </div>
                  </div>
                  {s.watched_count > 0 && (
                    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/10">
                      <div className="h-full bg-accent" style={{ width: `${(100 * s.watched_count) / s.video_count}%` }} />
                    </div>
                  )}
                </Link>
              ))}
          </div>
        </section>
      )}

      {c && !syncing && (
        <Organise
          channelId={channelId}
          onChange={() => {
            seriesList.reload()
            page.reload()
          }}
        />
      )}

      {timeline.data && timeline.data.length > 1 && (
        <section className="mb-6">
          <Timeline buckets={timeline.data} value={from} onChange={(m) => set({ from: m, sort: m ? 'oldest' : null })} />
          {c?.years && (
            <div className="no-scrollbar mt-2 flex gap-1 overflow-x-auto">
              {c.years.map((y) => (
                <button
                  key={y.year}
                  onClick={() => set({ from: `${y.year}-01`, sort: 'oldest' })}
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${from?.startsWith(y.year) ? 'bg-accent text-white' : 'bg-neutral-800 text-neutral-300 hover:bg-neutral-700'}`}
                >
                  {y.year}
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search titles…"
          className="min-w-48 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm outline-none focus:border-accent"
        />
        <select value={series} onChange={(e) => set({ series: e.target.value || null })} className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm">
          <option value="">All series</option>
          <option value="none">Unsorted</option>
          {seriesList.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.video_count})
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => set({ sort: e.target.value })} className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="views">Most viewed</option>
          <option value="longest">Longest</option>
        </select>
        <span className="text-xs text-neutral-500">{fmtCount(total)} videos</span>
      </section>

      {page.error && <p className="text-red-400">{page.error}</p>}
      <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {items.map((v) => (
          <VideoCard key={v.id} video={v} />
        ))}
      </div>
      {items.length < total && (
        <div className="mt-8 text-center">
          <button onClick={() => setOffset(items.length)} disabled={page.loading} className="rounded-lg border border-neutral-700 px-5 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50">
            {page.loading ? 'Loading…' : `Load more (${fmtCount(total - items.length)} left)`}
          </button>
        </div>
      )}
      {!page.loading && total === 0 && !syncing && <p className="py-10 text-center text-neutral-500">Nothing here.</p>}
    </div>
  )
}
