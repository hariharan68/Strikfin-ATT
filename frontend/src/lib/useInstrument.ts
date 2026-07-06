import { useSearchParams } from 'react-router-dom'
import type { InstrumentId } from '../api/endpoints'

/**
 * Instrument selection backed by the `?inst=` query param so it stays in sync
 * with the instrument tabs / search and survives reloads.
 *
 * Accepts ANY instrument id (not just 1/2). An absent or non-numeric param
 * defaults to instrument 1 (the first built-in index) so existing links and a
 * bare /dashboard keep working.
 */
export function useInstrument(): [InstrumentId, (id: InstrumentId) => void] {
  const [params, setParams] = useSearchParams()
  const raw = Number(params.get('inst'))
  const value: InstrumentId = Number.isFinite(raw) && raw > 0 ? raw : 1

  const setValue = (id: InstrumentId) => {
    const next = new URLSearchParams(params)
    next.set('inst', String(id))
    setParams(next, { replace: true })
  }

  return [value, setValue]
}
