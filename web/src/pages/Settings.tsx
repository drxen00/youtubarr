import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { api, type Download, type Settings, type User } from '../api'
import { useIsAdmin, useUser } from '../auth'
import { useApi, useInterval } from '../hooks'
import { fmtCount, fmtRelative } from '../lib/format'

export default function SettingsPage() {
  const isAdmin = useIsAdmin()
  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-8">
      <Account />
      {isAdmin && (
        <>
          <Users />
          <ApiKey />
          <Downloads />
          <Seeds />
        </>
      )}
      <Shortcuts />
    </div>
  )
}

const field = 'rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm outline-none focus:border-accent'
const btn = 'rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50'
const primary = 'rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50'

function Account() {
  const user = useUser()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    try {
      await api('/api/auth/password', { method: 'PUT', json: { current, password: next } })
      setCurrent('')
      setNext('')
      setMsg('Password changed.')
    } catch (err) {
      setMsg((err as Error).message)
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Your account</h2>
      <p className="mb-3 text-sm text-neutral-400">
        Signed in as <b className="text-neutral-200">{user.username}</b> ({user.role}).
      </p>
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" className={field} />
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+)" className={field} />
        <button disabled={!current || next.length < 8} className={primary}>
          Change password
        </button>
      </form>
      {msg && <p className="mt-2 text-sm text-neutral-300">{msg}</p>}
    </section>
  )
}

function Users() {
  const me = useUser()
  const users = useApi<User[]>('/api/users')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [msg, setMsg] = useState<string | null>(null)

  async function act(fn: () => Promise<unknown>, done?: string) {
    setMsg(null)
    try {
      await fn()
      users.reload()
      if (done) setMsg(done)
    } catch (e) {
      setMsg((e as Error).message)
    }
  }

  function create(e: FormEvent) {
    e.preventDefault()
    act(() => api('/api/users', { method: 'POST', json: { username, password, role } }), `Added ${username}.`).then(() => {
      setUsername('')
      setPassword('')
    })
  }

  function resetPassword(u: User) {
    const p = prompt(`New password for ${u.username} (8+ characters). They'll be logged out everywhere.`)
    if (p) act(() => api(`/api/users/${u.id}`, { method: 'PUT', json: { password: p } }), `Password reset for ${u.username}.`)
  }

  return (
    <section>
      <h2 className="mb-1 text-lg font-semibold">Users</h2>
      <p className="mb-3 text-sm text-neutral-400">
        Everyone gets their own watch history. <b>Users</b> can browse and watch; <b>admins</b> can also add channels, edit series, download, and manage this page.
      </p>
      <ul className="mb-4 divide-y divide-neutral-800 rounded-xl border border-neutral-800 text-sm">
        {users.data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 p-3">
            <span className="font-medium">{u.username}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${u.role === 'admin' ? 'bg-accent/20 text-accent' : 'bg-neutral-800 text-neutral-300'}`}>{u.role}</span>
            <span className="text-xs text-neutral-500">{u.last_login_at ? `active ${fmtRelative(u.last_login_at)}` : 'never signed in'}</span>
            <span className="ml-auto flex gap-3 text-xs text-neutral-400">
              <button onClick={() => resetPassword(u)} className="hover:text-white">
                reset password
              </button>
              {u.id !== me.id && (
                <>
                  <button onClick={() => act(() => api(`/api/users/${u.id}`, { method: 'PUT', json: { role: u.role === 'admin' ? 'user' : 'admin' } }))} className="hover:text-white">
                    make {u.role === 'admin' ? 'user' : 'admin'}
                  </button>
                  <button onClick={() => confirm(`Delete ${u.username} and their watch history?`) && act(() => api(`/api/users/${u.id}`, { method: 'DELETE' }))} className="hover:text-red-400">
                    delete
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className={field} />
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+)" className={field} />
        <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} className={field}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button disabled={username.length < 2 || password.length < 8} className={primary}>
          Add user
        </button>
      </form>
      {msg && <p className="mt-2 text-sm text-neutral-300">{msg}</p>}
    </section>
  )
}

function ApiKey() {
  const settings = useApi<Settings>('/api/settings')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

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
    <section>
      <h2 className="mb-2 text-lg font-semibold">YouTube Data API key</h2>
      <p className="mb-3 text-sm text-neutral-400">
        Needed to index channels. Create one in the{' '}
        <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline">
          Google Cloud console
        </a>{' '}
        after enabling <b>YouTube Data API v3</b> on the project. Indexing a 5,000-video channel costs ~200 of your 10,000 daily units; a routine refresh costs 2–3.
      </p>
      <div className="flex gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={s?.youtubeApiKeySet ? (s.youtubeApiKeyFromEnv ? 'Set via YOUTUBE_API_KEY env' : '•••••••• (saved)') : 'AIza…'}
          className={`flex-1 font-mono ${field}`}
        />
        <button disabled={!key.trim()} onClick={() => saveKey(key)} className={primary}>
          Save
        </button>
        {s?.youtubeApiKeySet && !s.youtubeApiKeyFromEnv && (
          <button onClick={() => saveKey(null)} className={btn}>
            Remove
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-sm text-neutral-300">{msg}</p>}
    </section>
  )
}

function Downloads() {
  const settings = useApi<Settings>('/api/settings')
  const downloads = useApi<Download[]>('/api/downloads')
  const active = downloads.data?.some((d) => d.status === 'queued' || d.status === 'downloading') ?? false
  useInterval(downloads.reload, 2000, active)
  const s = settings.data

  return (
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
  )
}

function Seeds() {
  const settings = useApi<Settings>('/api/settings')
  return (
    <section>
      <h2 className="mb-2 text-lg font-semibold">Starter rulesets</h2>
      <p className="mb-2 text-sm text-neutral-400">Bundled series rules, applied automatically when a matching channel is added.</p>
      <ul className="text-sm text-neutral-300">
        {settings.data?.seeds.map((seed) => (
          <li key={seed.file}>
            <code>{seed.file}</code> — {seed.channels.join(', ')} · {seed.seriesCount} series
          </li>
        ))}
      </ul>
    </section>
  )
}

function Shortcuts() {
  return (
    <section className="text-xs text-neutral-500">
      <h2 className="mb-1 font-semibold text-neutral-400">Keyboard shortcuts (player)</h2>
      <p>
        <kbd>Space</kbd>/<kbd>K</kbd> play · <kbd>J</kbd>/<kbd>L</kbd> ±10s · <kbd>←</kbd>/<kbd>→</kbd> ±5s (Shift: ±60s) · <kbd>0–9</kbd> jump · <kbd>Shift+N</kbd>/<kbd>Shift+P</kbd> next/prev episode ·{' '}
        <kbd>[</kbd>/<kbd>]</kbd> older/newer upload · <kbd>F</kbd> fullscreen · <kbd>M</kbd> mute
      </p>
    </section>
  )
}
