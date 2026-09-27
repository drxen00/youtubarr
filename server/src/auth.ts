import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  adminCount,
  authenticate,
  completeSetup,
  createSession,
  createUser,
  deleteUser,
  destroySession,
  getUser,
  listUsers,
  setPassword,
  setRole,
  setupRequired,
  userForSession,
  validPassword,
  validUsername,
  verifyPassword,
  type Role,
  type User,
} from './users.js'
import { db } from './db.js'

const COOKIE = 'yt_session'
const COOKIE_OPTS = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: 'auto' as const, maxAge: 60 * 60 * 24 * 365 }

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null
  }
}

// ---- login rate limit (per IP, in memory) --------------------------------------
const MAX_FAILS = 10
const WINDOW_MS = 15 * 60_000
const fails = new Map<string, { n: number; until: number }>()
function limited(ip: string): boolean {
  const f = fails.get(ip)
  if (!f) return false
  if (Date.now() > f.until) {
    fails.delete(ip)
    return false
  }
  return f.n >= MAX_FAILS
}
function recordFail(ip: string) {
  const f = fails.get(ip)
  if (!f || Date.now() > f.until) fails.set(ip, { n: 1, until: Date.now() + WINDOW_MS })
  else f.n++
}

/**
 * Everyone signed in can browse, watch, add channels, sync, organise their own series and queue
 * downloads. Only these are reserved for admins: user management, the API key / settings, removing a
 * shared channel, and deleting shared downloaded files.
 */
const ADMIN_ONLY = [/^\w+ \/api\/users/, /^\w+ \/api\/settings$/, /^DELETE \/api\/channels\/[^/]+$/, /^DELETE \/api\/videos\/[^/]+\/download$/]

function bad(reply: FastifyReply, code: number, msg: string) {
  return reply.code(code).send({ error: msg })
}

export function registerAuth(app: FastifyInstance) {
  app.decorateRequest('user', null)

  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0] ?? ''
    const isApi = url.startsWith('/api/') || url.startsWith('/media/')
    if (!isApi) return
    req.user = userForSession(req.cookies[COOKIE])
    if (url.startsWith('/api/auth/') || url === '/api/health') return
    if (!req.user) return bad(reply, 401, 'Unauthorized')
    if (req.user.role !== 'admin' && ADMIN_ONLY.some((re) => re.test(`${req.method} ${url}`))) return bad(reply, 403, 'Admins only')
  })

  app.get('/api/auth/status', async (req) => ({
    setupRequired: setupRequired(),
    authenticated: !!req.user,
    user: req.user,
  }))

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/setup', async (req, reply) => {
    if (!setupRequired()) return bad(reply, 409, 'Setup already completed')
    const { username = '', password = '' } = req.body ?? {}
    if (!validUsername(username)) return bad(reply, 400, 'Username: 2–32 letters, digits, . _ -')
    if (!validPassword(password)) return bad(reply, 400, 'Password must be at least 8 characters')
    const user = completeSetup(username, password)
    reply.setCookie(COOKIE, createSession(user.id, req.headers['user-agent']), COOKIE_OPTS)
    return { ok: true, user }
  })

  app.post<{ Body: { username?: string; password?: string } }>('/api/auth/login', async (req, reply) => {
    if (limited(req.ip)) return bad(reply, 429, 'Too many attempts. Try again in a few minutes.')
    const { username = '', password = '' } = req.body ?? {}
    const user = authenticate(username, password)
    if (!user) {
      recordFail(req.ip)
      await new Promise((r) => setTimeout(r, 300))
      return bad(reply, 401, 'Wrong username or password')
    }
    reply.setCookie(COOKIE, createSession(user.id, req.headers['user-agent']), COOKIE_OPTS)
    return { ok: true, user }
  })

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req.cookies[COOKIE])
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  app.put<{ Body: { current?: string; password?: string } }>('/api/auth/password', async (req, reply) => {
    if (!req.user) return bad(reply, 401, 'Unauthorized')
    const { current = '', password = '' } = req.body ?? {}
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id) as { password_hash: string }
    if (!verifyPassword(current, row.password_hash)) return bad(reply, 400, 'Current password is wrong')
    if (!validPassword(password)) return bad(reply, 400, 'New password must be at least 8 characters')
    setPassword(req.user.id, password)
    reply.setCookie(COOKIE, createSession(req.user.id, req.headers['user-agent']), COOKIE_OPTS)
    return { ok: true }
  })

  // ---- user management (admin; the hook already blocks non-admins) ---------------
  app.get('/api/users', async () => listUsers())

  app.post<{ Body: { username?: string; password?: string; role?: Role } }>('/api/users', async (req, reply) => {
    const { username = '', password = '', role = 'user' } = req.body ?? {}
    if (!validUsername(username)) return bad(reply, 400, 'Username: 2–32 letters, digits, . _ -')
    if (!validPassword(password)) return bad(reply, 400, 'Password must be at least 8 characters')
    if (role !== 'admin' && role !== 'user') return bad(reply, 400, 'Bad role')
    try {
      return createUser(username, password, role)
    } catch (e) {
      if (String(e).includes('UNIQUE')) return bad(reply, 409, 'That username is taken')
      throw e
    }
  })

  app.put<{ Params: { id: string }; Body: { password?: string; role?: Role } }>('/api/users/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const target = getUser(id)
    if (!target) return bad(reply, 404, 'not found')
    const b = req.body ?? {}
    if (b.password !== undefined) {
      if (!validPassword(b.password)) return bad(reply, 400, 'Password must be at least 8 characters')
      setPassword(id, b.password)
    }
    if (b.role !== undefined) {
      if (b.role !== 'admin' && b.role !== 'user') return bad(reply, 400, 'Bad role')
      if (target.role === 'admin' && b.role !== 'admin' && adminCount() <= 1) return bad(reply, 400, 'Cannot demote the last admin')
      setRole(id, b.role)
    }
    return getUser(id)
  })

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req, reply) => {
    const id = Number(req.params.id)
    const target = getUser(id)
    if (!target) return bad(reply, 404, 'not found')
    if (target.id === req.user!.id) return bad(reply, 400, 'You cannot delete yourself')
    if (target.role === 'admin' && adminCount() <= 1) return bad(reply, 400, 'Cannot delete the last admin')
    deleteUser(id)
    return { ok: true }
  })
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
  return req.user
}
