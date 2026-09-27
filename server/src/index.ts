import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyCookie from '@fastify/cookie'
import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.js'
import { registerAuth } from './auth.js'
import { registerRoutes } from './routes.js'
import * as downloads from './downloads.js'

const app = Fastify({ logger: { level: config.isProd ? 'info' : 'debug' }, trustProxy: true })

await app.register(fastifyCookie)
registerAuth(app)
registerRoutes(app)

// Downloaded files, with Range support so the native player can seek.
await app.register(fastifyStatic, {
  root: config.mediaDir,
  prefix: '/media/files/',
  decorateReply: false,
  serve: false,
})
app.get<{ Params: { id: string } }>('/media/:id', async (req, reply) => {
  const rel = downloads.localFile(req.params.id)
  if (!rel) return reply.code(404).send({ error: 'not downloaded' })
  return reply.sendFile(rel, config.mediaDir, { acceptRanges: true })
})

// SPA
if (fs.existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, prefix: '/', wildcard: false, decorateReply: false })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/media/')) return reply.code(404).send({ error: 'not found' })
    return reply.type('text/html').send(fs.createReadStream(path.join(config.webDist, 'index.html')))
  })
} else {
  app.log.warn(`No built frontend at ${config.webDist}; API only (run the Vite dev server for the UI).`)
}

const ytdlp = await downloads.probeYtDlp()
app.log.info(ytdlp ? `yt-dlp ${ytdlp} available` : 'yt-dlp not found; downloads disabled')
downloads.resumeQueue()

await app.listen({ port: config.port, host: config.host })
