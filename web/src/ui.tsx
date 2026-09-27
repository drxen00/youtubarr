import type { SVGProps } from 'react'

/** Shared class recipes so every page speaks the same visual language. */
export const cls = {
  btn: 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm font-medium text-neutral-200 transition hover:border-white/20 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-40',
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 py-1.5 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(239,68,68,0.7)] transition hover:bg-red-500 disabled:pointer-events-none disabled:opacity-40',
  ghost: 'inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-neutral-300 transition hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-30',
  danger: 'inline-flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-red-400 transition hover:bg-red-500/10 hover:text-red-300',
  input: 'rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-neutral-500 focus:border-accent/70 focus:bg-white/[0.07]',
  select: 'rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-2 text-sm text-neutral-200 outline-none focus:border-accent/70',
  card: 'rounded-2xl border border-white/[0.06] bg-white/[0.03]',
  label: 'text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-500',
  chip: 'inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-neutral-300',
}

const paths: Record<string, string> = {
  back: 'M19 12H5M12 19l-7-7 7-7',
  download: 'M12 3v12M6 11l6 6 6-6M4 21h16',
  check: 'M20 6L9 17l-5-5',
  plus: 'M12 5v14M5 12h14',
  sync: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  search: 'M21 21l-4.3-4.3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  chevronDown: 'M6 9l6 6 6-6',
  chevronRight: 'M9 6l6 6-6 6',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
  skipBack: 'M19 20L9 12l10-8v16zM5 19V5',
  skipFwd: 'M5 4l10 8-10 8V4zM19 5v14',
  fullscreen: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  user: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM4 21a8 8 0 0 1 16 0',
  users: 'M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM2 21a7 7 0 0 1 14 0M17 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7z',
  copy: 'M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1',
  playlist: 'M4 6h13M4 12h13M4 18h7M19 15l-4 2.5v-5z',
  film: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM7 4v16M17 4v16M2 9h5M17 9h5M2 15h5M17 15h5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  key: 'M21 2l-2 2M11.4 11.6a5 5 0 1 1-7.1 7.1 5 5 0 0 1 7.1-7.1zm0 0L19 4m-3.5 3.5L18 10',
  x: 'M18 6L6 18M6 6l12 12',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM9 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  server: 'M4 4h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM4 14h16a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1zM7 7h.01M7 17h.01',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 3v6h6M12 7v5l3 2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  rewind: 'M11 19l-8-7 8-7v14zM21 19l-8-7 8-7v14z',
  forward: 'M13 5l8 7-8 7V5zM3 5l8 7-8 7V5z',
}

export function Icon({ name, size = 16, className = '', ...rest }: { name: keyof typeof paths | 'play' | 'pause'; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  if (name === 'play')
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" {...rest}>
        <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" />
      </svg>
    )
  if (name === 'pause')
    return (
      <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" {...rest}>
        <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
      </svg>
    )
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...rest}>
      <path d={paths[name]} />
    </svg>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block size-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white ${className}`} />
}

export const SOURCE_LABEL: Record<string, string> = { playlist: 'Playlist', detected: 'Detected', seed: 'Starter', rules: 'Custom' }
