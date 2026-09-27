import { useState } from 'react'
import { api, qs, type Suggestion } from '../api'
import { useApi } from '../hooks'

/**
 * "Organise" panel on the channel page: pull the creator's playlists, or review title-pattern
 * suggestions and turn the ones you like into series.
 */
export default function Organise({ channelId, onChange }: { channelId: string; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const [min, setMin] = useState(3)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const suggestions = useApi<Suggestion[]>(open ? `/api/channels/${channelId}/organise/suggest${qs({ min })}` : null)

  async function run(label: string, fn: () => Promise<string>) {
    setBusy(label)
    setMsg(null)
    try {
      setMsg(await fn())
      onChange()
      suggestions.reload()
      setPicked(new Set())
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const importPlaylists = () =>
    run('playlists', async () => {
      const r = await api<{ playlists: number; assigned: number; skipped: number }>(`/api/channels/${channelId}/organise/playlists`, { method: 'POST' })
      return `Imported ${r.playlists} playlists (${r.assigned} videos assigned, ${r.skipped} skipped as unrelated).`
    })

  const create = (picks: Suggestion[]) =>
    run('create', async () => {
      const r = await api<{ created: number }>(`/api/channels/${channelId}/organise/create`, {
        method: 'POST',
        json: { picks: picks.map((p) => ({ name: p.name, pattern: p.pattern })) },
      })
      return `Created ${r.created} series.`
    })

  const toggle = (name: string) => {
    const next = new Set(picked)
    next.has(name) ? next.delete(name) : next.add(name)
    setPicked(next)
  }

  return (
    <section className="mb-8 rounded-xl border border-neutral-800 bg-neutral-900/40">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm">
        <span className="font-semibold uppercase tracking-wide text-neutral-400">Organise into series</span>
        <span className="text-neutral-500">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-neutral-800 px-4 py-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <button disabled={!!busy} onClick={importPlaylists} className="rounded-lg border border-neutral-700 px-3 py-1.5 hover:bg-neutral-800 disabled:opacity-50">
              {busy === 'playlists' ? 'Importing…' : "Import the channel's playlists"}
            </button>
            <span className="text-xs text-neutral-500">Uses the creator's own playlists as series. ~1 API unit per playlist.</span>
          </div>
          {msg && <p className="text-neutral-300">{msg}</p>}

          <div>
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h3 className="font-medium">Suggested from titles</h3>
              <label className="flex items-center gap-2 text-xs text-neutral-400">
                at least
                <input type="number" min={2} value={min} onChange={(e) => setMin(Math.max(2, Number(e.target.value) || 2))} className="w-14 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-0.5" />
                videos
              </label>
              {suggestions.data && suggestions.data.length > 0 && (
                <>
                  <button disabled={!!busy || picked.size === 0} onClick={() => create(suggestions.data!.filter((s) => picked.has(s.name)))} className="rounded-lg bg-accent px-3 py-1 text-white disabled:opacity-40">
                    Create selected ({picked.size})
                  </button>
                  <button disabled={!!busy} onClick={() => create(suggestions.data!)} className="rounded-lg border border-neutral-700 px-3 py-1 hover:bg-neutral-800 disabled:opacity-50">
                    Create all {suggestions.data.length}
                  </button>
                </>
              )}
            </div>
            <p className="mb-2 text-xs text-neutral-500">
              Recurring title prefixes among videos not yet in a series — "Minecraft Hardcore #12" → <i>Minecraft Hardcore</i>. Each one becomes a series with an editable rule.
            </p>
            {suggestions.loading && <p className="text-neutral-500">Scanning titles…</p>}
            {suggestions.data?.length === 0 && <p className="text-neutral-500">Nothing recurring left to group at this threshold.</p>}
            <ul className="grid gap-2 md:grid-cols-2">
              {suggestions.data?.map((s) => (
                <li key={s.name} className={`rounded-lg border p-2 ${picked.has(s.name) ? 'border-accent bg-accent/10' : 'border-neutral-800'}`}>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" checked={picked.has(s.name)} onChange={() => toggle(s.name)} className="mt-1" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-medium">{s.name}</span>
                        <span className="shrink-0 text-xs text-neutral-400">{s.count} videos</span>
                      </div>
                      <ul className="mt-1 space-y-0.5 text-xs text-neutral-500">
                        {s.sample.slice(0, 3).map((t, i) => (
                          <li key={i} className="truncate">
                            {t}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
