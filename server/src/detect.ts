/**
 * Heuristic series detection from titles alone. Let's-play channels name episodes like
 * "Minecraft Hardcore #12", "GTA V - Part 3", "Subnautica | Ep. 4 | Big Fish", so we strip episode
 * markers and bracketed noise, take the leading segment, and count recurring prefixes.
 */

export interface TitleRow {
  id: string
  title: string
}

export interface Suggestion {
  name: string
  /** Regex (case-insensitive) that reproduces this grouping. */
  pattern: string
  count: number
  videoIds: string[]
  sample: string[]
}

const STOP = new Set(
  'the a an and or of in on at to for with my i we you it is are was be this that these those from by vs new video videos vlog day ep episode part pt live stream'.split(' '),
)

const EPISODE_MARKERS = [
  /\s*[#№]\s*\d+[a-z]?\b/gi,
  /\b(?:part|pt\.?|episode|ep\.?|chapter|ch\.?|day|week|round|level|stage|season|s\d+e)\s*\d+[a-z]?\b/gi,
  /\b\d+\s*(?:st|nd|rd|th)?\s*(?:part|episode|ep)\b/gi,
  /\s*[([{]\s*(?:part|ep|episode)?\s*\d+\s*[)\]}]/gi,
  /\s*[-–—|:]\s*\d+\s*$/g, // trailing "- 12"
  /\s+\d+\s*$/g, // trailing bare number
  /\s*[([{][^)\]}]*[)\]}]/g, // any remaining bracketed tag: (Gameplay), [HD], {Live}
]

export function cleanTitle(title: string): string {
  let t = title.normalize('NFKC')
  for (const re of EPISODE_MARKERS) t = t.replace(re, ' ')
  return t
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*([-–—|:•·»])(?:\s*[-–—|:•·»])+\s*/g, ' $1 ') // "| |" left behind by a stripped marker
    .replace(/^[\s\-–—|:•·»]+|[\s\-–—|:•·»]+$/g, '')
    .trim()
}

/** Leading segment before a separator, if it looks like a label rather than a sentence. */
export function leadingSegment(clean: string): string | null {
  const seg = clean.split(/\s+[-–—|•·»]\s+|:\s+/)[0]?.trim() ?? ''
  const words = seg.split(' ').filter(Boolean)
  if (seg.length < 3 || words.length === 0 || words.length > 6) return null
  if (words.every((w) => STOP.has(w.toLowerCase()))) return null
  return seg
}

function norm(s: string) {
  return s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, '').replace(/\s+/g, ' ').trim()
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Groups titles by recurring leading phrases. `exclude` removes the channel's own name so
 * "PewDiePie - ..." doesn't become a series.
 */
export function suggestSeries(rows: TitleRow[], opts: { minCount?: number; exclude?: string[] } = {}): Suggestion[] {
  const minCount = opts.minCount ?? 4
  const exclude = new Set((opts.exclude ?? []).map(norm).filter(Boolean))

  // Candidate keys per video: the leading segment, and its leading 2- and 3-word phrases.
  const keyVideos = new Map<string, Set<string>>()
  const keyLabel = new Map<string, string>()
  const perVideo = new Map<string, string[]>()
  for (const r of rows) {
    const clean = cleanTitle(r.title)
    const seg = leadingSegment(clean) ?? (clean.split(' ').length <= 6 ? clean : null)
    if (!seg) continue
    const words = seg.split(' ')
    const cands = new Set<string>()
    cands.add(seg)
    if (words.length >= 3) cands.add(words.slice(0, 3).join(' '))
    if (words.length >= 2) cands.add(words.slice(0, 2).join(' '))
    const keys: string[] = []
    for (const c of cands) {
      const k = norm(c)
      if (k.length < 3 || exclude.has(k)) continue
      const kw = k.split(' ')
      if (kw.every((w) => STOP.has(w)) || (kw.length === 1 && k.length < 5)) continue
      keys.push(k)
      if (!keyLabel.has(k)) keyLabel.set(k, c)
      let set = keyVideos.get(k)
      if (!set) keyVideos.set(k, (set = new Set()))
      set.add(r.id)
    }
    perVideo.set(r.id, keys.sort((a, b) => b.length - a.length)) // most specific first
  }

  // Each video goes to its most specific key that clears the threshold.
  const assigned = new Map<string, string[]>()
  for (const [id, keys] of perVideo) {
    const k = keys.find((key) => (keyVideos.get(key)?.size ?? 0) >= minCount)
    if (!k) continue
    let list = assigned.get(k)
    if (!list) assigned.set(k, (list = []))
    list.push(id)
  }

  const titleOf = new Map(rows.map((r) => [r.id, r.title]))
  const out: Suggestion[] = []
  for (const [k, ids] of assigned) {
    if (ids.length < minCount) continue
    const label = keyLabel.get(k) ?? k
    out.push({
      name: label,
      pattern: `\\b${escapeRegex(label).replace(/\s+/g, '\\s+')}\\b`,
      count: ids.length,
      videoIds: ids,
      sample: ids.slice(0, 5).map((id) => titleOf.get(id) ?? ''),
    })
  }
  return out.sort((a, b) => b.count - a.count)
}
