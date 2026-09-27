import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { api, UNAUTHORIZED_EVENT, type AuthStatus, type User } from './api'
import { UserContext } from './auth'
import Login from './pages/Login'

type State = { kind: 'checking' } | { kind: 'setup' } | { kind: 'login' } | { kind: 'ok'; user: User }

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
      <div className="min-h-dvh flex flex-col">
        {!isWatch && (
          <header className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
            <div className="mx-auto flex h-12 max-w-screen-2xl items-center gap-4 px-4">
              <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
                <span className="grid size-6 place-items-center rounded-md bg-accent text-white">
                  <svg viewBox="0 0 24 24" className="size-3.5 fill-current"><path d="M8 5v14l11-7z" /></svg>
                </span>
                youtubarr
              </Link>
              <nav className="ml-auto flex items-center gap-3 text-sm text-neutral-400">
                <Link to="/settings" className="hover:text-white" title={user.role === 'admin' ? 'Settings' : 'Your account'}>
                  {user.username}
                </Link>
                <button onClick={logout} className="hover:text-white">
                  Log out
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
