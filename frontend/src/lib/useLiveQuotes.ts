import { useEffect, useRef, useState } from 'react'
import { liveFeed } from './liveFeed'
import type { FeedMessage, QuoteData } from './liveFeed'

/**
 * Subscribe to live `quote:{id}` updates for a set of instruments and return the
 * latest quote per instrument id. Prices update in real time over the shared
 * WebSocket — no polling. Unsubscribes on unmount.
 */
export function useLiveQuotes(instrumentIds: number[]): Record<number, QuoteData> {
  const [quotes, setQuotes] = useState<Record<number, QuoteData>>({})
  const key = instrumentIds.join(',')
  const idsRef = useRef(instrumentIds)
  idsRef.current = instrumentIds

  useEffect(() => {
    const ids = idsRef.current
    const channels = ids.map((id) => `quote:${id}`)
    const onMsg = (msg: FeedMessage) => {
      if (msg.type === 'quote' && msg.data && typeof msg.data.instrument_id === 'number') {
        setQuotes((prev) => ({ ...prev, [msg.data!.instrument_id]: msg.data as QuoteData }))
      }
    }
    liveFeed.addListener(onMsg)
    channels.forEach((c) => liveFeed.subscribe(c))
    return () => {
      channels.forEach((c) => liveFeed.unsubscribe(c))
      liveFeed.removeListener(onMsg)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return quotes
}

/** Convenience for a single instrument. */
export function useLiveQuote(instrumentId: number): QuoteData | undefined {
  return useLiveQuotes([instrumentId])[instrumentId]
}
