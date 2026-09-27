export function fmtDuration(total: number | null | undefined): string {
  const s = Math.max(0, Math.floor(total ?? 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return dateFmt.format(new Date(iso))
}

const monthFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short' })
export function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return monthFmt.format(new Date(y ?? 2000, (m ?? 1) - 1, 1))
}

export function fmtCount(n: number | null | undefined): string {
  if (n == null) return ''
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}K`
  return String(n)
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return ''
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  const units: [number, string][] = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']]
  for (const [secs, name] of units) {
    if (diff >= secs) {
      const n = Math.floor(diff / secs)
      return `${n} ${name}${n === 1 ? '' : 's'} ago`
    }
  }
  return 'just now'
}
