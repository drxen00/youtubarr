import { useState, type FormEvent } from 'react'
import { api, type User } from '../api'

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

  const field = 'w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 outline-none focus:border-accent'

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
        <div>
          <h1 className="text-lg font-semibold">youtubarr</h1>
          {setup && <p className="mt-1 text-sm text-neutral-400">First run — create the admin account. You can add friends from Settings afterwards.</p>}
        </div>
        <input autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className={field} />
        <input
          type="password"
          autoComplete={setup ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={setup ? 'Password (8+ characters)' : 'Password'}
          className={field}
        />
        {setup && <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" className={field} />}
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-accent py-2 font-medium text-white disabled:opacity-50">
          {busy ? '…' : setup ? 'Create admin account' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}
