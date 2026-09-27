import { useState, type FormEvent } from 'react'
import { api, type User } from '../api'
import { Logo } from '../App'
import { cls } from '../ui'

export default function Login({ mode, onSuccess }: { mode: 'login' | 'setup'; onSuccess: (user: User) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setup = mode === 'setup'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (setup && password !== confirm) return setError("Passwords don't match")
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ user: User }>(setup ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', json: { username, password } })
      onSuccess(r.user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={submit} className={`fade-up w-full max-w-sm space-y-5 p-7 ${cls.card} shadow-2xl shadow-black/60`}>
        <div className="flex items-center gap-3">
          <Logo size={36} />
          <div>
            <h1 className="text-lg font-semibold leading-tight">youtubarr</h1>
            <p className="text-xs text-neutral-500">{setup ? 'First run — create the admin account' : 'Sign in to continue'}</p>
          </div>
        </div>
        <div className="space-y-3">
          <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className={`w-full ${cls.input}`} />
          <input
            type="password"
            autoComplete={setup ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={setup ? 'Password (8+ characters)' : 'Password'}
            className={`w-full ${cls.input}`}
          />
          {setup && <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" className={`w-full ${cls.input}`} />}
        </div>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button disabled={busy} className={`w-full py-2.5 ${cls.primary}`}>
          {busy ? '…' : setup ? 'Create admin account' : 'Sign in'}
        </button>
        {setup && <p className="text-center text-xs text-neutral-500">You'll be able to add friends as users from Settings.</p>}
      </form>
    </div>
  )
}
