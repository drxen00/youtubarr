import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { api, UNAUTHORIZED_EVENT, type AuthStatus, type User } from './api'
import { UserContext } from './auth'
import Login from './pages/Login'
import { cls, Icon } from './ui'

type State = { kind: 'checking' } | { kind: 'setup' } | { kind: 'login' } | { kind: 'ok'; user: User }

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <span className="grid place-items-center rounded-lg bg-accent text-white shadow-[0_6px_16px_-6px_rgba(239,68,68,0.8)]" style={{ width: size, height: size }}>
      <Icon name="play" size={size * 0.55} />
    </span>
  )
}

export default function App() {
  const [state, setState] = useState<State>({ kind: 'checking' })
  const location = useLocation()
  const isWatch = location.pathname.startsWith('/watch/')

  useEffect(() => {
    api<AuthStatus>('/api/auth/status')
      .then((s) => setState(s.setupRequired ? { kind: 'setup' } : s.user ? { kind: 'ok', user: s.user } : { kind: 'login' }))
      .catch(() => setState({ kind: 'login' }))
    const onUnauthorized = () => setState((s) => (s.kind === 'ok' ? { kind: 'login' } : s))
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  if (state.kind === 'checking') return null
  if (state.kind !== 'ok') return <Login mode={state.kind} onSuccess={(user) => setState({ kind: 'ok', user })} />

  const { user } = state
  const logout = () => api('/api/auth/logout', { method: 'POST' }).then(() => setState({ kind: 'login' }))

  return (
    <UserContext.Provider value={user}>
      <div className="flex min-h-dvh flex-col">
        {!isWatch && (
          <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-neutral-950/70 backdrop-blur-xl">
            <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-4 px-4">
              <Link to="/" className="flex items-center gap-2.5 font-semibold tracking-tight">
                <Logo />
                <span>youtubarr</span>
              </Link>
              <nav className="ml-auto flex items-center gap-1">
                <Link to="/settings" className={cls.ghost} title={user.role === 'admin' ? 'Settings' : 'Your account'}>
                  <Icon name={user.role === 'admin' ? 'settings' : 'user'} />
                  <span className="hidden sm:inline">{user.username}</span>
                </Link>
                <button onClick={logout} className={cls.ghost} title="Log out">
                  <Icon name="logout" />
                </button>
              </nav>
            </div>
          </header>
        )}
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </UserContext.Provider>
  )
}
