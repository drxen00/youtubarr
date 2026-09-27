import { useState } from 'react'
import { api, qs, type OrganiseInfo, type Suggestion } from '../api'
import { useApi } from '../hooks'
import { cls, Icon, Spinner } from '../ui'

/**
 * How a user gets series for a channel: a bundled starter ruleset, a friend's setup, the creator's
 * playlists, or title detection. Shown expanded until the user has organised the channel once.
 */
export default function SeriesSetup({ channelId, forceOpen, onChange }: { channelId: string; forceOpen: boolean; onChange: () => void }) {
  const info = useApi<OrganiseInfo>(`/api/channels/${channelId}/organise`)
  const [open, setOpen] = useState(forceOpen)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [showSuggest, setShowSuggest] = useState(false)
  const [min, setMin] = useState(3)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const suggestions = useApi<Suggestion[]>(open && showSuggest ? `/api/channels/${channelId}/organise/suggest${qs({ min })}` : null)

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label)
    setMsg(null)
    try {
      setMsg(await fn())
      onChange()
      info.reload()
      suggestions.reload()
      setPicked(new Set())
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const seed = () =>
    run('seed', async () => {
      const r = await api<{ series: number; rules: number; assigned: number }>(`/api/channels/${channelId}/organise/seed`, { method: 'POST', json: {} })
      return `Imported ${r.series} series with ${r.rules} rules · ${r.assigned} videos sorted.`
    })
  const copy = (fromUserId: number, name: string) =>
    run(`copy${fromUserId}`, async () => {
      const r = await api<{ series: number; rules: number; assigned: number }>(`/api/channels/${channelId}/organise/copy`, { method: 'POST', json: { fromUserId } })
      return `Copied ${r.series} series from ${name} · ${r.assigned} videos sorted.`
    })
  const playlists = () =>
    run('playlists', async () => {
      const r = await api<{ playlists: number; assigned: number; skipped: number }>(`/api/channels/${channelId}/organise/playlists`, { method: 'POST' })
      return `Imported ${r.playlists} playlists · ${r.assigned} videos sorted (${r.skipped} unrelated playlists skipped).`
    })
  const auto = () =>
    run('auto', async () => {
      const r = await api<{ seeded: string | null; playlists: number; detected: number }>(`/api/channels/${channelId}/organise/auto`, { method: 'POST' })
      return r.seeded ? 'Starter ruleset applied.' : `Imported ${r.playlists} playlists and detected ${r.detected} series from titles.`
    })
  const create = (picks: Suggestion[]) =>
    run('create', async () => {
      const r = await api<{ created: number }>(`/api/channels/${channelId}/organise/create`, { method: 'POST', json: { picks: picks.map((p) => ({ name: p.name, pattern: p.pattern })) } })
      return `Created ${r.created} series.`
    })

  const toggle = (name: string) => {
    const next = new Set(picked)
    next.has(name) ? next.delete(name) : next.add(name)
    setPicked(next)
  }

  const d = info.data
  const Option = ({ icon, title, desc, action, id, disabled }: { icon: Parameters<typeof Icon>[0]['name']; title: string; desc: string; action: () => void; id: string; disabled?: boolean }) => (
    <button onClick={action} disabled={!!busy || disabled} className={`group flex items-start gap-3 p-3.5 text-left ${cls.card} transition hover:border-white/20 hover:bg-white/[0.05] disabled:opacity-40`}>
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-neutral-300 group-hover:bg-accent group-hover:text-white">
        {busy === id ? <Spinner /> : <Icon name={icon} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs leading-relaxed text-neutral-500">{desc}</span>
      </span>
    </button>
  )

  return (
    <section className={`mb-8 ${cls.card} ${!d?.organised && open ? 'ring-1 ring-accent/40' : ''}`}>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className="grid size-7 place-items-center rounded-lg bg-accent/15 text-accent">
          <Icon name="sparkles" size={15} />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">{d?.organised ? 'Organise into series' : 'Set up your series for this channel'}</span>
          <span className="block text-xs text-neutral-500">
            {d?.organised ? 'Add more series from playlists or title patterns. Your series are yours alone.' : 'Series are per person — pick how you want this catalogue sorted.'}
          </span>
        </span>
        <Icon name="chevronDown" className={`text-neutral-500 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && d && (
        <div className="space-y-4 border-t border-white/[0.06] px-4 py-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {d.seed && <Option id="seed" icon="sparkles" title="Use the starter ruleset" desc="Curated series and rules bundled for this creator. Best starting point when available." action={seed} />}
            {d.others.map((o) => (
              <Option
                key={o.user_id}
                id={`copy${o.user_id}`}
                icon="copy"
                title={`Copy ${o.username}'s series`}
                desc={`${o.series_count} series covering ${o.assigned_count} videos. Rules and manual picks come along; you can edit freely afterwards.`}
                action={() => copy(o.user_id, o.username)}
              />
            ))}
            <Option id="playlists" icon="playlist" title="Import the channel's playlists" desc="The creator's own playlists become series. ~1 API unit per playlist." action={playlists} />
            <Option id="detect" icon="search" title="Detect series from titles" desc={'"Minecraft Hardcore #12" → Minecraft Hardcore. Review the suggestions and create the ones you like.'} action={() => setShowSuggest(true)} />
            {!d.organised && !d.seed && <Option id="auto" icon="sync" title="Just do it automatically" desc="Playlists plus any title pattern that recurs 5+ times." action={auto} />}
          </div>
          {msg && <p className="text-sm text-neutral-300">{msg}</p>}

          {showSuggest && (
            <div className="rounded-xl border border-white/[0.06] bg-black/20 p-3.5">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h3 className="text-sm font-medium">Suggested from titles</h3>
                <label className="flex items-center gap-2 text-xs text-neutral-400">
                  at least
                  <input type="number" min={2} value={min} onChange={(e) => setMin(Math.max(2, Number(e.target.value) || 2))} className={`w-14 px-2 py-0.5 ${cls.input}`} />
                  videos
                </label>
                {suggestions.data && suggestions.data.length > 0 && (
                  <span className="ml-auto flex gap-2">
                    <button disabled={!!busy || picked.size === 0} onClick={() => create(suggestions.data!.filter((s) => picked.has(s.name)))} className={cls.primary}>
                      Create selected ({picked.size})
                    </button>
                    <button disabled={!!busy} onClick={() => create(suggestions.data!)} className={cls.btn}>
                      Create all {suggestions.data.length}
                    </button>
                  </span>
                )}
              </div>
              {suggestions.loading && (
                <p className="flex items-center gap-2 text-sm text-neutral-500">
                  <Spinner /> Scanning titles…
                </p>
              )}
              {suggestions.data?.length === 0 && <p className="text-sm text-neutral-500">Nothing recurring left to group at this threshold.</p>}
              <ul className="grid gap-2 md:grid-cols-2">
                {suggestions.data?.map((s) => (
                  <li key={s.name} className={`rounded-lg border p-2.5 transition ${picked.has(s.name) ? 'border-accent bg-accent/10' : 'border-white/[0.06] hover:border-white/15'}`}>
                    <label className="flex cursor-pointer items-start gap-2">
                      <input type="checkbox" checked={picked.has(s.name)} onChange={() => toggle(s.name)} className="mt-1 accent-[#ef4444]" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{s.name}</span>
                          <span className="shrink-0 text-xs text-neutral-500">{s.count} videos</span>
                        </span>
                        <span className="mt-1 block space-y-0.5 text-xs text-neutral-500">
                          {s.sample.slice(0, 3).map((t, i) => (
                            <span key={i} className="block truncate">
                              {t}
                            </span>
                          ))}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
