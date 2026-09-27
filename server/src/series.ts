import fs from 'node:fs'
import path from 'node:path'
import { db, transaction } from './db.js'
import { config } from './config.js'

export interface RuleDef {
  seriesId: number
  seriesPriority: number
  pattern: string
  flags: string
}

export interface CompiledRule {
  seriesId: number
  seriesPriority: number
  regex: RegExp
}

export function compileRules(rules: RuleDef[]): CompiledRule[] {
  const out: CompiledRule[] = []
  for (const r of rules) {
    try {
      out.push({ seriesId: r.seriesId, seriesPriority: r.seriesPriority, regex: new RegExp(r.pattern, r.flags) })
    } catch {
      // A bad user-entered regex must not take the whole engine down; the UI validates on save too.
    }
  }
  // Higher priority first; stable so rule order breaks ties.
  return out.sort((a, b) => b.seriesPriority - a.seriesPriority)
}

/** Returns the series id whose highest-priority rule matches the title, or null. */
export function matchSeries(title: string, rules: CompiledRule[]): number | null {
  for (const r of rules) {
    r.regex.lastIndex = 0
    if (r.regex.test(title)) return r.seriesId
  }
  return null
}

export function loadRules(channelId: string): CompiledRule[] {
  const rows = db
    .prepare(
      `SELECT r.series_id AS seriesId, s.priority AS seriesPriority, r.pattern, r.flags
       FROM series_rules r JOIN series s ON s.id = r.series_id
       WHERE s.channel_id = ? AND r.enabled = 1
       ORDER BY r.id`,
    )
    .all(channelId) as unknown as RuleDef[]
  return compileRules(rows)
}

/** Re-runs rules over every video the rules engine owns (not manual picks, not playlist picks). */
export function applyRules(channelId: string): { assigned: number; cleared: number; unchanged: number } {
  const rules = loadRules(channelId)
  const videos = db
    .prepare(`SELECT id, title, series_id FROM videos WHERE channel_id = ? AND (series_source IS NULL OR series_source = 'rule')`)
    .all(channelId) as { id: string; title: string; series_id: number | null }[]
  const update = db.prepare(`UPDATE videos SET series_id = ?, series_source = CASE WHEN ? IS NULL THEN NULL ELSE 'rule' END WHERE id = ?`)
  let assigned = 0
  let cleared = 0
  let unchanged = 0
  transaction(() => {
    for (const v of videos) {
      const next = matchSeries(v.title, rules)
      if (next === v.series_id) {
        unchanged++
        continue
      }
      update.run(next, next, v.id)
      if (next === null) cleared++
      else assigned++
    }
  })
  return { assigned, cleared, unchanged }
}

// ---- seeds ------------------------------------------------------------------

export interface SeedSeries {
  name: string
  color?: string
  priority?: number
  patterns: (string | { pattern: string; flags?: string })[]
}
export interface SeedFile {
  /** Channel ids or handles this seed applies to. */
  channels: string[]
  series: SeedSeries[]
}

export function listSeeds(): { file: string; channels: string[]; seriesCount: number }[] {
  if (!fs.existsSync(config.seedsDir)) return []
  return fs
    .readdirSync(config.seedsDir)
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      const seed = JSON.parse(fs.readFileSync(path.join(config.seedsDir, file), 'utf8')) as SeedFile
      return { file, channels: seed.channels, seriesCount: seed.series.length }
    })
}

export function findSeedFor(channelId: string, handle: string | null): string | null {
  const wanted = new Set([channelId.toLowerCase(), (handle ?? '').toLowerCase()])
  for (const s of listSeeds()) {
    if (s.channels.some((c) => wanted.has(c.toLowerCase()))) return s.file
  }
  return null
}

/** Inserts seed series + rules for a channel. Existing series with the same name get their rules appended. */
export function importSeed(channelId: string, file: string): { series: number; rules: number } {
  const seed = JSON.parse(fs.readFileSync(path.join(config.seedsDir, path.basename(file)), 'utf8')) as SeedFile
  const insertSeries = db.prepare(
    `INSERT INTO series (channel_id, name, color, priority, source) VALUES (?, ?, ?, ?, 'seed')
     ON CONFLICT(channel_id, name) DO UPDATE SET color = COALESCE(series.color, excluded.color)
     RETURNING id`,
  )
  const insertRule = db.prepare('INSERT INTO series_rules (series_id, pattern, flags) VALUES (?, ?, ?)')
  const existingRule = db.prepare('SELECT 1 FROM series_rules WHERE series_id = ? AND pattern = ?')
  let series = 0
  let rules = 0
  transaction(() => {
    for (const s of seed.series) {
      const { id } = insertSeries.get(channelId, s.name, s.color ?? null, s.priority ?? 0) as { id: number }
      series++
      for (const p of s.patterns) {
        const pattern = typeof p === 'string' ? p : p.pattern
        const flags = typeof p === 'string' ? 'i' : (p.flags ?? 'i')
        if (existingRule.get(id, pattern)) continue
        insertRule.run(id, pattern, flags)
        rules++
      }
    }
  })
  return { series, rules }
}
