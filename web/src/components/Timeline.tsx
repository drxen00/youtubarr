import { useMemo, useRef, type PointerEvent } from 'react'
import { fmtMonth } from '../lib/format'

export interface Bucket {
  month: string // YYYY-MM
  count: number
}

/**
 * A scrubbable histogram of uploads per month. Drag or click to land on a month; the parent
 * uses that as the "from" point of the grid so you can browse forward from any moment in history.
 */
export default function Timeline({ buckets, value, onChange }: { buckets: Bucket[]; value: string | null; onChange: (month: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null)

  // Fill gaps so quiet months still take space (keeps the x-axis linear in time).
  const months = useMemo(() => {
    if (buckets.length === 0) return []
    const map = new Map(buckets.map((b) => [b.month, b.count]))
    const first = buckets[0]!.month
    const last = buckets[buckets.length - 1]!.month
    const out: Bucket[] = []
    let [y, m] = first.split('-').map(Number) as [number, number]
    const [ly, lm] = last.split('-').map(Number) as [number, number]
    while (y < ly || (y === ly && m <= lm)) {
      const key = `${y}-${String(m).padStart(2, '0')}`
      out.push({ month: key, count: map.get(key) ?? 0 })
      m++
      if (m > 12) {
        m = 1
        y++
      }
    }
    return out
  }, [buckets])

  const max = useMemo(() => Math.max(1, ...months.map((b) => b.count)), [months])
  const yearStarts = months.map((b, i) => (b.month.endsWith('-01') || i === 0 ? { i, year: b.month.slice(0, 4) } : null)).filter(Boolean) as { i: number; year: string }[]

  function monthAt(clientX: number): string | null {
    const el = ref.current
    if (!el || months.length === 0) return null
    const rect = el.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return months[Math.min(months.length - 1, Math.floor(frac * months.length))]!.month
  }

  function onPointer(e: PointerEvent<HTMLDivElement>) {
    if (e.type === 'pointerdown') (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
    if (e.type === 'pointermove' && e.buttons === 0) return
    const m = monthAt(e.clientX)
    if (m && m !== value) onChange(m)
  }

  if (months.length === 0) return null
  const selectedIdx = value ? months.findIndex((b) => b.month === value) : -1

  return (
    <div className="select-none">
      <div className="mb-1 flex items-center justify-between text-xs text-neutral-400">
        <span>{value ? `From ${fmtMonth(value)}` : 'Timeline — drag to jump to a point in time'}</span>
        {value && (
          <button onClick={() => onChange(null)} className="text-neutral-300 hover:text-white">
            Clear
          </button>
        )}
      </div>
      <div
        ref={ref}
        onPointerDown={onPointer}
        onPointerMove={onPointer}
        className="relative flex h-16 cursor-ew-resize items-end gap-px rounded-md bg-neutral-900 px-1 pt-1 touch-none"
      >
        {months.map((b, i) => (
          <div
            key={b.month}
            className={`flex-1 rounded-t-sm ${selectedIdx >= 0 && i < selectedIdx ? 'bg-neutral-700' : i === selectedIdx ? 'bg-accent' : 'bg-neutral-500'}`}
            style={{ height: `${Math.max(4, (100 * b.count) / max)}%` }}
          />
        ))}
        {selectedIdx >= 0 && (
          <div className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: `${((selectedIdx + 0.5) / months.length) * 100}%` }} />
        )}
      </div>
      <div className="relative mt-1 h-4 text-[10px] text-neutral-500">
        {yearStarts.map(({ i, year }, k) => {
          const next = yearStarts[k + 1]?.i ?? months.length
          if (next - i < months.length / 40) return null
          return (
            <span key={year} className="absolute" style={{ left: `${(i / months.length) * 100}%` }}>
              {year}
            </span>
          )
        })}
      </div>
    </div>
  )
}
