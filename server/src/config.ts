import path from 'node:path'
import fs from 'node:fs'

const root = process.cwd()

function dir(envName: string, fallback: string): string {
  const p = path.resolve(root, process.env[envName] || fallback)
  fs.mkdirSync(p, { recursive: true })
  return p
}

export const config = {
  port: Number(process.env.PORT || 8790),
  host: process.env.HOST || '0.0.0.0',
  dataDir: dir('DATA_DIR', './data'),
  mediaDir: dir('MEDIA_DIR', './media'),
  /** Env-provided API key; the Settings page can override it via the settings table. */
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  appPassword: process.env.APP_PASSWORD || '',
  isProd: process.env.NODE_ENV === 'production',
  /** Built SPA (server/dist/../../web/dist in prod, ../web/dist in dev). */
  webDist: path.resolve(root, process.env.WEB_DIST || (fs.existsSync(path.resolve(root, 'web/dist')) ? 'web/dist' : '../web/dist')),
  seedsDir: path.resolve(root, fs.existsSync(path.resolve(root, 'server/seeds')) ? 'server/seeds' : 'seeds'),
}
