import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { api, qs, type Channel, type Page, type Series, type Video } from '../api'
import { useApi, useInterval } from '../hooks'
import Timeline, { type Bucket } from '../components/Timeline'
import VideoCard from '../components/VideoCard'
import SeriesSetup from '../components/SeriesSetup'
import DownloadMenu from '../components/DownloadMenu'
import BackLink from '../components/BackLink'
import { fmtCount, fmtRelative } from '../lib/format'
import { cls, Icon, SOURCE_LABEL, Spinner } from '../ui'

const PAGE = 60

export default function ChannelPage() {
  const { channelId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const series = params.get('series') ?? ''
  const q = params.get('q') ?? ''
  const from = params.get('from') // YYYY-MM
  const downloaded = params.get('downloaded') === '1'
  const sort = params.get('sort') ?? (from ? 'oldest' : 'newest')
  const [offset, setOffset] = useState(0)
  const [items, setItems] = useState<Video[]>([])
  const [search, setSearch] = useState(q)

  const channel = useApi<Channel>(`/api/channels/${channelId}`)
  const seriesList = useApi<Series[]>(`/api/channels/${channelId}/series`)
  const timeline = useApi<Bucket[]>(`/api/channels/${channelId}/timeline${qs({ series })}`)
  const cont = useApi<Video[]>(`/api/channels/${channelId}/continue`)

  const syncing = channel.data?.sync.state === 'running'
  useInterval(
    () => {
      channel.reload()
      seriesList.reload()
      timeline.reload()
    },
    3000,
    !!syncing,
  )

  const listPath = useMemo(
    () => `/api/channels/${channelId}/videos${qs({ series, q, from: from ? `${from}-01` : undefined, sort, limit: PAGE, offset, downloaded: downloaded ? 1 : undefined })}`,
    [channelId, series, q, from, sort, offset, downloaded],
  )
  const page = useApi<Page<Video>>(listPath)

  useEffect(() => {
    setOffset(0)
    setItems([])
  }, [channelId, series, q, from, sort, downloaded])
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

  const refreshAll = () => {
    channel.reload()
    seriesList.reload()
    timeline.reload()
    page.reload()
  }

  const c = channel.data
  const total = page.data?.total ?? 0
  const filtered = !!(series || q || from || downloaded)

  return (
    <div className="pb-16">
      {/* ---- hero */}
      <div className="relative">
        {c?.banner_url && (
          <div className="absolute inset-0 -z-10 overflow-hidden">
            <img src={`${c.banner_url}=w2120`} alt="" className="size-full scale-110 object-cover opacity-40 blur-2xl" />
            <div className="absolute inset-0 bg-gradient-to-b from-neutral-950/30 via-neutral-950/70 to-neutral-950" />
          </div>
        )}
        <div className="mx-auto max-w-screen-2xl px-4 pt-3">
          <BackLink to="/" label="Channels" />
          {c && (
            <header className="fade-up flex flex-wrap items-end gap-5 py-5">
              <img src={c.thumbnail_url ?? ''} alt="" className="size-20 rounded-full bg-neutral-800 shadow-xl ring-4 ring-neutral-950/60 sm:size-24" />
              <div className="min-w-0 flex-1">
                <h1 className="text-3xl font-bold tracking-tight">{c.title}</h1>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className={cls.chip}>{c.handle}</span>
                  <span className={cls.chip}>
                    <Icon name="film" size={12} /> {fmtCount(c.video_count)} videos
                  </span>
                  {c.subscriber_count != null && (
                    <span className={cls.chip}>
                      <Icon name="users" size={12} /> {fmtCount(c.subscriber_count)}
                    </span>
                  )}
                  {(c.downloaded_count ?? 0) > 0 && (
                    <span className={`${cls.chip} border-emerald-500/30 text-emerald-300`}>
                      <Icon name="server" size={12} /> {c.downloaded_count} on server
                    </span>
                  )}
                  <span className="ml-1 text-neutral-500">
                    {syncing ? (
                      <span className="inline-flex items-center gap-1.5 text-accent">
                        <Spinner /> {c.sync.phase === 'organising' ? 'Organising into series…' : `Indexing ${c.sync.fetched}/${c.sync.total || '?'}…`}
                      </span>
                    ) : c.sync.state === 'error' ? (
                      <span className="text-red-400">Sync failed: {c.sync.error}</span>
                    ) : c.last_synced_at ? (
                      `Synced ${fmtRelative(c.last_synced_at)}`
                    ) : (
                      'Not synced yet'
                    )}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={syncing} onClick={() => api(`/api/channels/${channelId}/sync`, { method: 'POST', json: {} }).then(channel.reload)} className={cls.btn} title="Check for new uploads (2–3 API units)">
                  <Icon name="sync" /> Sync
                </button>
                <Link to={`/series/new?channel=${channelId}`} className={cls.btn}>
                  <Icon name="plus" /> Series
                </Link>
                {seriesList.data && <DownloadMenu series={seriesList.data} onChange={refreshAll} />}
              </div>
            </header>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-screen-2xl px-4">
        {c && !syncing && <SeriesSetup channelId={channelId} forceOpen={!c.organised} onChange={refreshAll} />}

        {cont.data && cont.data.length > 0 && !filtered && (
          <section className="mb-8">
            <h2 className={`mb-3 ${cls.label}`}>Continue watching</h2>
            <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4">
              {cont.data.map((v) => (
                <div key={v.id} className="w-64 shrink-0">
                  <VideoCard video={v} />
                </div>
              ))}
            </div>
          </section>
        )}

        {seriesList.data && seriesList.data.some((s) => s.video_count > 0) && (
          <section className="mb-8">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className={cls.label}>Your series</h2>
              <span className="text-xs text-neutral-500">{seriesList.data.filter((s) => s.video_count > 0).length} series</span>
            </div>
            <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
              {seriesList.data
                .filter((s) => s.video_count > 0)
                .map((s) => (
                  <Link key={s.id} to={`/series/${s.id}`} className={`group relative w-48 shrink-0 overflow-hidden ${cls.card} transition hover:-translate-y-0.5 hover:border-white/20`}>
                    <div className="relative aspect-video bg-neutral-900">
                      {s.thumbnail_url && <img src={s.thumbnail_url} alt="" loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-105" />}
                      <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/20 to-transparent" />
                      <div className="absolute inset-x-0 top-0 h-1" style={{ background: s.color ?? '#525252' }} />
                      <div className="absolute bottom-2 left-2.5 right-2.5">
                        <div className="truncate text-sm font-semibold drop-shadow">{s.name}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-neutral-400">
                      <span>{s.video_count} eps</span>
                      {s.source === 'playlist' && <span className="rounded bg-white/5 px-1 text-neutral-500">{SOURCE_LABEL[s.source]}</span>}
                      {s.downloaded_count > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-emerald-400">
                          <Icon name="server" size={11} /> {s.downloaded_count}
                        </span>
                      )}
                      {s.watched_count > 0 && <span className="ml-auto">{Math.round((100 * s.watched_count) / s.video_count)}%</span>}
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

        {timeline.data && timeline.data.length > 1 && (
          <section className={`mb-6 p-4 ${cls.card}`}>
            <Timeline buckets={timeline.data} value={from} onChange={(m) => set({ from: m, sort: m ? 'oldest' : null })} />
            {c?.years && (
              <div className="no-scrollbar mt-3 flex gap-1 overflow-x-auto">
                {c.years.map((y) => (
                  <button
                    key={y.year}
                    onClick={() => set({ from: from?.startsWith(y.year) ? null : `${y.year}-01`, sort: from?.startsWith(y.year) ? null : 'oldest' })}
                    className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition ${from?.startsWith(y.year) ? 'bg-accent text-white' : 'bg-white/5 text-neutral-300 hover:bg-white/10'}`}
                  >
                    {y.year}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="mb-5 flex flex-wrap items-center gap-2">
          <label className="relative min-w-48 flex-1">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search titles…" className={`w-full pl-9 ${cls.input}`} />
          </label>
          <select value={series} onChange={(e) => set({ series: e.target.value || null })} className={cls.select}>
            <option value="">All series</option>
            <option value="none">Unsorted</option>
            {seriesList.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.video_count})
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => set({ sort: e.target.value })} className={cls.select}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="views">Most viewed</option>
            <option value="longest">Longest</option>
          </select>
          <button onClick={() => set({ downloaded: downloaded ? null : '1' })} className={`${cls.btn} ${downloaded ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : ''}`} title="Only videos stored on the server">
            <Icon name="server" size={14} /> On server
          </button>
          <span className="text-xs text-neutral-500">{fmtCount(total)} videos</span>
        </section>

        {page.error && <p className="text-red-400">{page.error}</p>}
        <div className="grid gap-x-4 gap-y-7 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
        {items.length < total && (
          <div className="mt-10 text-center">
            <button onClick={() => setOffset(items.length)} disabled={page.loading} className={cls.btn}>
              {page.loading ? <Spinner /> : <Icon name="chevronDown" />}
              Load more ({fmtCount(total - items.length)} left)
            </button>
          </div>
        )}
        {!page.loading && total === 0 && !syncing && <p className="py-16 text-center text-neutral-500">Nothing here.</p>}
      </div>
    </div>
  )
}
