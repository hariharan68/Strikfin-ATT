import { useSearchParams } from 'react-router-dom'
import type { InstrumentId } from '../api/endpoints'

/**
 * Instrument selection backed by the `?inst=` query param so it stays in sync
 * with the navbar's NIFTY 50 / SENSEX links and survives reloads.
 */
export function useInstrument(): [InstrumentId, (id: InstrumentId) => void] {
  const [params, setParams] = useSearchParams()
  const value: InstrumentId = params.get('inst') === '2' ? 2 : 1

  const setValue = (id: InstrumentId) => {
    const next = new URLSearchParams(params)
    next.set('inst', String(id))
    setParams(next, { replace: true })
  }

  return [value, setValue]
}
