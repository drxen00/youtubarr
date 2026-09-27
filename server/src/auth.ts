import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { config } from './config.js'
import { getSetting, setSetting } from './db.js'

const COOKIE = 'youtubarr_session'

function secret(): string {
  let s = getSetting('session_secret')
  if (!s) {
    s = randomBytes(32).toString('hex')
    setSetting('session_secret', s)
  }
  return s
}

function token(): string {
  return createHmac('sha256', secret()).update(config.appPassword).digest('hex')
}

function safeEq(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const authRequired = () => config.appPassword.length > 0

export function registerAuth(app: FastifyInstance) {
  app.get('/api/auth/status', async (req) => ({
    required: authRequired(),
    authenticated: !authRequired() || isAuthed(req.cookies[COOKIE]),
  }))

  app.post<{ Body: { password?: string } }>('/api/auth/login', async (req, reply) => {
    if (!authRequired()) return { ok: true }
    if (typeof req.body?.password !== 'string' || !safeEq(req.body.password, config.appPassword)) {
      await new Promise((r) => setTimeout(r, 400))
      return reply.code(401).send({ error: 'Wrong password' })
    }
    reply.setCookie(COOKIE, token(), { path: '/', httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 60 * 60 * 24 * 365 })
    return { ok: true }
  })

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' })
    return { ok: true }
  })

  app.addHook('onRequest', async (req, reply) => {
    if (!authRequired()) return
    const url = req.url.split('?')[0] ?? ''
    const protectedPath = url.startsWith('/api/') || url.startsWith('/media/')
    if (!protectedPath || url.startsWith('/api/auth/') || url === '/api/health') return
    if (!isAuthed(req.cookies[COOKIE])) return reply.code(401).send({ error: 'Unauthorized' })
  })
}

function isAuthed(cookie: string | undefined): boolean {
  return !!cookie && safeEq(cookie, token())
}
