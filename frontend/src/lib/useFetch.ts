import { useCallback, useEffect, useRef, useState } from 'react'
import type { DependencyList } from 'react'
import { getErrorMessage } from '../api/client'

interface UseFetchOptions {
  /** Poll interval in ms. Refreshes happen silently (no loading flicker). */
  intervalMs?: number
  /** Skip fetching when false. */
  enabled?: boolean
}

interface UseFetchResult<T> {
  data: T | null
  error: string | null
  loading: boolean
  refreshing: boolean
  refetch: () => void
}

/**
 * Data fetching with first-load loading state, optional interval polling, and
 * safe unmount handling. Re-runs whenever `deps` change (e.g. instrument id),
 * showing the loading state again so skeletons appear.
 */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  options: UseFetchOptions = {},
): UseFetchResult<T> {
  const { intervalMs, enabled = true } = options
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const mounted = useRef(true)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const run = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') setRefreshing(true)
    try {
      const result = await fetcherRef.current()
      if (!mounted.current) return
      setData(result)
      setError(null)
    } catch (err) {
      if (!mounted.current) return
      setError(getErrorMessage(err))
    } finally {
      if (mounted.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  const refetch = useCallback(() => {
    void run('refresh')
  }, [run])

  useEffect(() => {
    mounted.current = true
    if (!enabled) {
      setLoading(false)
      return
    }
    setLoading(true)
    void run('initial')

    let timer: number | undefined
    if (intervalMs && intervalMs > 0) {
      timer = window.setInterval(() => void run('refresh'), intervalMs)
    }
    return () => {
      mounted.current = false
      if (timer) window.clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled, intervalMs])

  return { data, error, loading, refreshing, refetch }
}
