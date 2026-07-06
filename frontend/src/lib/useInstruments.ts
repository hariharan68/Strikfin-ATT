import { useQuery } from '@tanstack/react-query'
import {
  getInstruments,
  searchInstruments,
  toInstrument,
  INSTRUMENTS,
} from '../api/endpoints'
import type { Instrument, InstrumentMeta } from '../api/endpoints'

/**
 * The live instrument catalog (from GET /instruments), cached by React Query.
 * Falls back to the static INSTRUMENTS seed while loading / on error so callers
 * always have a non-empty list and the UI never blanks.
 */
export function useInstruments() {
  const query = useQuery({
    queryKey: ['instruments'],
    queryFn: () => getInstruments(),
    staleTime: 5 * 60_000, // the master changes rarely
  })

  const meta: InstrumentMeta[] = query.data ?? []
  const catalog: Instrument[] = query.data?.length
    ? query.data.map(toInstrument)
    : INSTRUMENTS

  return { ...query, catalog, meta }
}

/** Look up one instrument's meta from the cached catalog. */
export function useInstrumentMeta(id: number): InstrumentMeta | undefined {
  const { meta } = useInstruments()
  return meta.find((m) => m.instrument_id === id)
}

/** Debounce-free search hook for the global instrument palette. */
export function useInstrumentSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: ['instruments', 'search', query],
    queryFn: () => searchInstruments(query),
    enabled,
    staleTime: 30_000,
  })
}
