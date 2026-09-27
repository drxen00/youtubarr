import { useEffect, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router'
import { api, UNAUTHORIZED_EVENT } from './api'
import Login from './pages/Login'

export default function App() {
  const [auth, setAuth] = useState<'checking' | 'ok' | 'login'>('checking')
  const location = useLocation()
  const isWatch = location.pathname.startsWith('/watch/')

  useEffect(() => {
    api<{ required: boolean; authenticated: boolean }>('/api/auth/status')
      .then((s) => setAuth(s.authenticated ? 'ok' : 'login'))
      .catch(() => setAuth('ok'))
    const onUnauthorized = () => setAuth('login')
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [])

  if (auth === 'checking') return null
  if (auth === 'login') return <Login onSuccess={() => setAuth('ok')} />

  return (
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
              <Link to="/settings" className="hover:text-white">Settings</Link>
            </nav>
          </div>
        </header>
      )}
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  )
}
