import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { api, type DownloadsResponse, type Settings, type User } from '../api'
import { useIsAdmin, useUser } from '../auth'
import { useApi, useInterval } from '../hooks'
import BackLink from '../components/BackLink'
import { fmtCount, fmtDuration, fmtRelative } from '../lib/format'
import { cls, Icon, Spinner } from '../ui'

export default function SettingsPage() {
  const isAdmin = useIsAdmin()
  return (
    <div className="mx-auto max-w-3xl px-4 py-4 pb-16">
      <BackLink to="/" label="Channels" />
      <h1 className="mb-6 mt-3 text-2xl font-bold tracking-tight">{isAdmin ? 'Settings' : 'Your account'}</h1>
      <div className="space-y-6">
        <Account />
        {isAdmin && <Users />}
        {isAdmin && <ApiKey />}
        <Downloads />
        {isAdmin && <Seeds />}
        <Shortcuts />
      </div>
    </div>
  )
}

function Section({ icon, title, desc, children, id }: { icon: Parameters<typeof Icon>[0]['name']; title: string; desc?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section id={id} className={`fade-up p-5 ${cls.card}`}>
      <div className="mb-4 flex items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/5 text-neutral-300">
          <Icon name={icon} />
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          {desc && <p className="text-sm text-neutral-500">{desc}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

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
    <Section
      icon="user"
      title={user.username}
      desc={
        <>
          {user.role === 'admin' ? 'Admin' : 'User'} · your series and watch history are private to you
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Current password" className={cls.input} />
        <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="New password (8+)" className={cls.input} />
        <button disabled={!current || next.length < 8} className={cls.primary}>
          Change password
        </button>
      </form>
      {msg && <p className="mt-2 text-sm text-neutral-300">{msg}</p>}
    </Section>
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
    <Section icon="users" title="Users" desc="Everyone can add channels, build their own series and queue downloads. Admins also manage users, the API key, and can remove channels or downloaded files.">
      <ul className="mb-4 divide-y divide-white/[0.06] rounded-xl border border-white/[0.06] text-sm">
        {users.data?.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 p-3">
            <span className="font-medium">{u.username}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs ${u.role === 'admin' ? 'bg-accent/15 text-accent' : 'bg-white/5 text-neutral-300'}`}>{u.role}</span>
            <span className="text-xs text-neutral-500">{u.last_login_at ? `active ${fmtRelative(u.last_login_at)}` : 'never signed in'}</span>
            <span className="ml-auto flex gap-1 text-xs">
              <button onClick={() => resetPassword(u)} className={cls.ghost}>
                <Icon name="key" size={13} /> reset
              </button>
              {u.id !== me.id && (
                <>
                  <button onClick={() => act(() => api(`/api/users/${u.id}`, { method: 'PUT', json: { role: u.role === 'admin' ? 'user' : 'admin' } }))} className={cls.ghost}>
                    make {u.role === 'admin' ? 'user' : 'admin'}
                  </button>
                  <button onClick={() => confirm(`Delete ${u.username}, their series and watch history?`) && act(() => api(`/api/users/${u.id}`, { method: 'DELETE' }))} className={cls.danger}>
                    <Icon name="trash" size={13} />
                  </button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className={cls.input} />
        <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (8+)" className={cls.input} />
        <select value={role} onChange={(e) => setRole(e.target.value as 'user' | 'admin')} className={cls.select}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
        <button disabled={username.length < 2 || password.length < 8} className={cls.primary}>
          <Icon name="plus" size={14} /> Add user
        </button>
      </form>
      {msg && <p className="mt-2 text-sm text-neutral-300">{msg}</p>}
    </Section>
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
    <Section
      icon="key"
      title="YouTube Data API key"
      desc={
        <>
          Needed to index channels. Create one in the{' '}
          <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="underline">
            Google Cloud console
          </a>{' '}
          after enabling <b>YouTube Data API v3</b>. A 5,000-video channel costs ~200 of 10,000 daily units; a refresh costs 2–3.
        </>
      }
    >
      <div className="flex flex-wrap gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={s?.youtubeApiKeySet ? (s.youtubeApiKeyFromEnv ? 'Set via YOUTUBE_API_KEY env' : '•••••••• (saved)') : 'AIza…'}
          className={`min-w-64 flex-1 font-mono ${cls.input}`}
        />
        <button disabled={!key.trim()} onClick={() => saveKey(key)} className={cls.primary}>
          Save
        </button>
        {s?.youtubeApiKeySet && !s.youtubeApiKeyFromEnv && (
          <button onClick={() => saveKey(null)} className={cls.btn}>
            Remove
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-sm text-neutral-300">{msg}</p>}
    </Section>
  )
}

function Downloads() {
  const isAdmin = useIsAdmin()
  const downloads = useApi<DownloadsResponse>('/api/downloads')
  const items = downloads.data?.items ?? []
  const active = items.some((d) => d.status === 'queued' || d.status === 'downloading')
  useInterval(downloads.reload, 2000, active)
  const done = items.filter((d) => d.status === 'done')
  const bytes = done.reduce((n, d) => n + (d.size_bytes ?? 0), 0)

  return (
    <Section
      id="downloads"
      icon="server"
      title="Downloads"
      desc={
        downloads.data?.ytDlpVersion ? (
          <>
            Shared by everyone · {done.length} videos · {fmtCount(Math.round(bytes / 1e9 * 10) / 10)} GB on the server · yt-dlp {downloads.data.ytDlpVersion}
          </>
        ) : (
          <span className="text-amber-400">yt-dlp not found — downloads are disabled. The Docker image includes it; for local dev, install it on your PATH.</span>
        )
      }
    >
      <ul className="scroll-thin max-h-[32rem] divide-y divide-white/[0.06] overflow-y-auto rounded-xl border border-white/[0.06]">
        {items.length === 0 && <li className="p-4 text-sm text-neutral-500">Nothing downloaded yet. Use the Download button on a channel, series, or video.</li>}
        {items.map((d) => (
          <li key={d.video_id} className="flex items-center gap-3 p-3 text-sm">
            {d.thumbnail_url && <img src={d.thumbnail_url} alt="" className="h-10 w-[71px] rounded-md object-cover" />}
            <div className="min-w-0 flex-1">
              <Link to={`/watch/${d.video_id}`} className="block truncate hover:underline">
                {d.title}
              </Link>
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span>{fmtDuration(d.duration_seconds)}</span>
                {d.status === 'downloading' && (
                  <span className="inline-flex items-center gap-1 text-accent">
                    <Spinner /> {Math.round(d.progress)}%
                  </span>
                )}
                {d.status === 'queued' && <span>Queued</span>}
                {d.status === 'done' && <span className="text-emerald-400">On server · {fmtCount(Math.round((d.size_bytes ?? 0) / 1e6))} MB</span>}
                {d.status === 'error' && <span className="text-red-400">{d.error}</span>}
              </div>
              {d.status === 'downloading' && (
                <div className="mt-1 h-1 rounded bg-white/10">
                  <div className="h-full rounded bg-accent transition-all" style={{ width: `${d.progress}%` }} />
                </div>
              )}
            </div>
            {isAdmin && (
              <button onClick={() => confirm(d.status === 'done' ? 'Delete this file for everyone?' : 'Cancel this download?') && api(`/api/videos/${d.video_id}/download`, { method: 'DELETE' }).then(downloads.reload)} className={cls.danger} title={d.status === 'done' ? 'Delete file' : 'Cancel'}>
                <Icon name={d.status === 'done' ? 'trash' : 'x'} size={14} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Seeds() {
  const settings = useApi<Settings>('/api/settings')
  return (
    <Section icon="sparkles" title="Starter rulesets" desc="Bundled series rules, offered to everyone when a matching channel is added.">
      <ul className="text-sm text-neutral-300">
        {settings.data?.seeds.map((seed) => (
          <li key={seed.file}>
            <code className="text-neutral-400">{seed.file}</code> — {seed.channels.join(', ')} · {seed.seriesCount} series
          </li>
        ))}
      </ul>
    </Section>
  )
}

function Shortcuts() {
  const K = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>
  return (
    <Section icon="film" title="Player shortcuts">
      <p className="text-xs leading-7 text-neutral-400">
        <K>Space</K> / <K>K</K> play · <K>J</K> / <K>L</K> ±10s · <K>←</K> / <K>→</K> ±5s (<K>Shift</K> ±60s) · <K>0</K>–<K>9</K> jump · <K>Shift+N</K> / <K>Shift+P</K> next / prev episode · <K>[</K> / <K>]</K> older / newer upload · <K>F</K> fullscreen · <K>M</K> mute
      </p>
    </Section>
  )
}
