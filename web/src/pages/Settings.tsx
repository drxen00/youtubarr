import { useState } from 'react'
import { Link } from 'react-router'
import { api, type Download, type Settings } from '../api'
import { useApi, useInterval } from '../hooks'
import { fmtCount } from '../lib/format'

export default function SettingsPage() {
  const settings = useApi<Settings>('/api/settings')
  const downloads = useApi<Download[]>('/api/downloads')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const active = downloads.data?.some((d) => d.status === 'queued' || d.status === 'downloading') ?? false
  useInterval(downloads.reload, 2000, active)

  async function saveKey(value: string | null) {
    setMsg(null)
    try {
      await api('/api/settings', { method: 'PUT', json: { youtubeApiKey: value } })
      setKey('')
      settings.reload()
      setMsg(value ? 'API key saved.' : 'API key removed.')
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  const s = settings.data
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      <section>
        <h2 className="mb-2 text-lg font-semibold">YouTube Data API key</h2>
        <p className="mb-3 text-sm text-neutral-400">
          Needed to index channels. Create one in the{' '}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline">
            Google Cloud console
          </a>{' '}
          after enabling <b>YouTube Data API v3</b> on the project. Indexing a 5,000-video channel costs ~200 of your 10,000 daily units; a
          routine refresh costs 2–3.
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder={s?.youtubeApiKeySet ? (s.youtubeApiKeyFromEnv ? 'Set via YOUTUBE_API_KEY env' : '•••••••• (saved)') : 'AIza…'}
            className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm outline-none focus:border-accent"
          />
          <button disabled={!key.trim()} onClick={() => saveKey(key)} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            Save
          </button>
          {s?.youtubeApiKeySet && !s.youtubeApiKeyFromEnv && (
            <button onClick={() => saveKey(null)} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">
              Remove
            </button>
          )}
        </div>
        {msg && <p className="mt-2 text-sm text-neutral-300">{msg}</p>}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Downloads</h2>
        <p className="mb-3 text-sm text-neutral-400">
          {s?.ytDlpVersion ? (
            <>
              yt-dlp <code>{s.ytDlpVersion}</code> · files go to <code>{s.mediaDir}</code>
            </>
          ) : (
            <span className="text-amber-400">yt-dlp not found — downloads are disabled. The Docker image includes it; for local dev, install it on your PATH.</span>
          )}
        </p>
        <ul className="divide-y divide-neutral-800 rounded-xl border border-neutral-800">
          {downloads.data?.length === 0 && <li className="p-3 text-sm text-neutral-500">Nothing downloaded yet.</li>}
          {downloads.data?.map((d) => (
            <li key={d.video_id} className="flex items-center gap-3 p-3 text-sm">
              {d.thumbnail_url && <img src={d.thumbnail_url} alt="" className="h-9 w-16 rounded object-cover" />}
              <div className="min-w-0 flex-1">
                <Link to={`/watch/${d.video_id}`} className="block truncate hover:underline">
                  {d.title}
                </Link>
                <div className="text-xs text-neutral-400">
                  {d.status === 'downloading' && `${Math.round(d.progress)}%`}
                  {d.status === 'queued' && 'Queued'}
                  {d.status === 'done' && `Done · ${fmtCount(Math.round((d.size_bytes ?? 0) / 1e6))} MB`}
                  {d.status === 'error' && <span className="text-red-400">{d.error}</span>}
                </div>
                {d.status === 'downloading' && (
                  <div className="mt-1 h-1 rounded bg-neutral-800">
                    <div className="h-full rounded bg-accent" style={{ width: `${d.progress}%` }} />
                  </div>
                )}
              </div>
              <button
                onClick={() => confirm(d.status === 'done' ? 'Delete file?' : 'Cancel download?') && api(`/api/videos/${d.video_id}/download`, { method: 'DELETE' }).then(downloads.reload)}
                className="text-neutral-400 hover:text-red-400"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Security</h2>
        <p className="text-sm text-neutral-400">
          {s?.passwordRequired ? (
            <>Password protection is on (<code>APP_PASSWORD</code>).</>
          ) : (
            <>
              No password set. If you expose this through a Cloudflare tunnel, either set <code>APP_PASSWORD</code> on the container or put Cloudflare Access in front.
            </>
          )}
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Starter rulesets</h2>
        <p className="mb-2 text-sm text-neutral-400">Bundled series rules, applied automatically when a matching channel is added.</p>
        <ul className="text-sm text-neutral-300">
          {s?.seeds.map((seed) => (
            <li key={seed.file}>
              <code>{seed.file}</code> — {seed.channels.join(', ')} · {seed.seriesCount} series
            </li>
          ))}
        </ul>
      </section>

      <section className="text-xs text-neutral-500">
        <h2 className="mb-1 font-semibold text-neutral-400">Keyboard shortcuts (player)</h2>
        <p>
          <kbd>Space</kbd>/<kbd>K</kbd> play · <kbd>J</kbd>/<kbd>L</kbd> ±10s · <kbd>←</kbd>/<kbd>→</kbd> ±5s (Shift: ±60s) · <kbd>0–9</kbd> jump · <kbd>Shift+N</kbd>/<kbd>Shift+P</kbd> next/prev
          episode · <kbd>[</kbd>/<kbd>]</kbd> older/newer upload · <kbd>F</kbd> fullscreen · <kbd>M</kbd> mute
        </p>
      </section>
    </div>
  )
}
