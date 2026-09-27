import { spawn, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { db } from './db.js'
import { config } from './config.js'

let ytDlpVersion: string | null = null
export function ytDlpAvailable() {
  return ytDlpVersion
}

export function probeYtDlp(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], (err, stdout) => {
      ytDlpVersion = err ? null : stdout.trim()
      resolve(ytDlpVersion)
    })
  })
}

const FORMAT = 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b'

let running = false
let current: { videoId: string; proc: ReturnType<typeof spawn> } | null = null

const setStatus = db.prepare(
  'UPDATE downloads SET status = ?, progress = ?, file_path = COALESCE(?, file_path), error = ?, size_bytes = COALESCE(?, size_bytes), updated_at = ? WHERE video_id = ?',
)

export function enqueue(videoId: string) {
  db.prepare(
    `INSERT INTO downloads (video_id, status, progress, error, updated_at) VALUES (?, 'queued', 0, NULL, ?)
     ON CONFLICT(video_id) DO UPDATE SET status = CASE WHEN downloads.status = 'done' THEN 'done' ELSE 'queued' END, error = NULL, updated_at = excluded.updated_at`,
  ).run(videoId, new Date().toISOString())
  void pump()
}

export function cancel(videoId: string) {
  if (current?.videoId === videoId) current.proc.kill('SIGTERM')
  const row = db.prepare('SELECT file_path FROM downloads WHERE video_id = ?').get(videoId) as { file_path: string | null } | undefined
  if (row?.file_path) {
    const abs = path.join(config.mediaDir, row.file_path)
    if (fs.existsSync(abs)) fs.rmSync(abs)
  }
  db.prepare('DELETE FROM downloads WHERE video_id = ?').run(videoId)
}

export function localFile(videoId: string): string | null {
  const row = db.prepare("SELECT file_path FROM downloads WHERE video_id = ? AND status = 'done'").get(videoId) as { file_path: string } | undefined
  if (!row) return null
  return fs.existsSync(path.join(config.mediaDir, row.file_path)) ? row.file_path : null
}

async function pump() {
  if (running) return
  running = true
  try {
    for (;;) {
      const next = db.prepare("SELECT video_id, (SELECT channel_id FROM videos WHERE id = video_id) AS channel_id FROM downloads WHERE status = 'queued' ORDER BY updated_at LIMIT 1").get() as
        | { video_id: string; channel_id: string }
        | undefined
      if (!next) break
      await run(next.video_id, next.channel_id)
    }
  } finally {
    running = false
  }
}

function run(videoId: string, channelId: string): Promise<void> {
  return new Promise((resolve) => {
    const rel = path.join(channelId, `${videoId}.mp4`)
    const outDir = path.join(config.mediaDir, channelId)
    fs.mkdirSync(outDir, { recursive: true })
    setStatus.run('downloading', 0, rel, null, null, new Date().toISOString(), videoId)

    const args = [
      '-f', FORMAT,
      '--merge-output-format', 'mp4',
      '--no-playlist', '--newline', '--no-warnings',
      '-o', path.join(outDir, `${videoId}.%(ext)s`),
      `https://www.youtube.com/watch?v=${videoId}`,
    ]
    const proc = spawn('yt-dlp', args)
    current = { videoId, proc }
    let stderr = ''
    let lastWrite = 0
    proc.stdout.on('data', (buf: Buffer) => {
      const m = /\[download\]\s+([\d.]+)%/.exec(buf.toString())
      if (m && Date.now() - lastWrite > 750) {
        lastWrite = Date.now()
        setStatus.run('downloading', Number(m[1]), null, null, null, new Date().toISOString(), videoId)
      }
    })
    proc.stderr.on('data', (buf: Buffer) => (stderr += buf.toString()))
    proc.on('error', (err) => {
      setStatus.run('error', 0, null, err.message, null, new Date().toISOString(), videoId)
      current = null
      resolve()
    })
    proc.on('close', (code) => {
      current = null
      const abs = path.join(config.mediaDir, rel)
      if (code === 0 && fs.existsSync(abs)) {
        setStatus.run('done', 100, rel, null, fs.statSync(abs).size, new Date().toISOString(), videoId)
      } else if (db.prepare('SELECT 1 FROM downloads WHERE video_id = ?').get(videoId)) {
        setStatus.run('error', 0, null, stderr.trim().split('\n').pop() || `yt-dlp exited ${code}`, null, new Date().toISOString(), videoId)
      }
      resolve()
    })
  })
}

/** Anything left in 'downloading' after a restart was interrupted; requeue it. */
export function resumeQueue() {
  db.prepare("UPDATE downloads SET status = 'queued' WHERE status = 'downloading'").run()
  void pump()
}
