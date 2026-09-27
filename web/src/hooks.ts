import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from './api'

export interface Loaded<T> {
  data: T | undefined
  error: string | null
  loading: boolean
  reload: () => void
  setData: (updater: T | ((prev: T | undefined) => T | undefined)) => void
}

/** Minimal fetch-on-mount hook; `path` null skips the request. */
export function useApi<T>(path: string | null, deps: unknown[] = []): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!path)
  const [tick, setTick] = useState(0)
  const latest = useRef(0)

  useEffect(() => {
    if (!path) {
      setLoading(false)
      return
    }
    const id = ++latest.current
    setLoading(true)
    setError(null)
    api<T>(path)
      .then((d) => {
        if (latest.current === id) setData(d)
      })
      .catch((e: Error) => {
        if (latest.current === id) setError(e.message)
      })
      .finally(() => {
        if (latest.current === id) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps])

  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { data, error, loading, reload, setData: setData as Loaded<T>['setData'] }
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (v: T) => {
      setValue(v)
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* ignore */
      }
    },
    [key],
  )
  return [value, set]
}

/** Polls `fn` every `ms` while `active`. */
export function useInterval(fn: () => void, ms: number, active = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => ref.current(), ms)
    return () => clearInterval(id)
  }, [ms, active])
}
