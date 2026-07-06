import { useAuthStore } from '../stores/authStore'

/**
 * Live market-data feed over the backend WebSocket (`/api/v1/ws`).
 *
 * A single shared connection multiplexes all channels: components subscribe to
 * `quote:{id}` etc. via ref-counted `subscribe`/`unsubscribe`, and one socket
 * fans messages to all listeners. Auto-reconnects with backoff and re-sends its
 * active subscriptions on reconnect. Mirrors the backend fan-out design.
 */
export interface QuoteData {
  instrument_id: number
  symbol?: string
  last_price?: number
  change_pct?: number
  india_vix?: number
  snap_ts?: string
  source?: string
}

export interface FeedMessage {
  type: string
  channel?: string
  data?: QuoteData & Record<string, unknown>
}

type Listener = (msg: FeedMessage) => void

function wsUrl(token: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/v1/ws?token=${encodeURIComponent(token)}`
}

class LiveFeed {
  private ws: WebSocket | null = null
  private opening = false
  private readonly channels = new Map<string, number>() // channel -> refcount
  private readonly listeners = new Set<Listener>()
  private reconnectDelay = 1000
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  connect(): void {
    if (this.ws || this.opening) return
    const token = useAuthStore.getState().accessToken
    if (!token) return // not authenticated yet; a later connect() will retry

    this.opening = true
    const ws = new WebSocket(wsUrl(token))
    this.ws = ws

    ws.onopen = () => {
      this.opening = false
      this.reconnectDelay = 1000
      // (Re)subscribe to every active channel.
      const active = [...this.channels.keys()].filter((c) => (this.channels.get(c) ?? 0) > 0)
      if (active.length) this.send({ action: 'subscribe', channels: active })
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as FeedMessage
        this.listeners.forEach((l) => l(msg))
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      this.ws = null
      this.opening = false
      this.scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.channels.size === 0) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 15000)
      this.connect()
    }, this.reconnectDelay)
  }

  private send(obj: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj))
    }
  }

  subscribe(channel: string): void {
    const n = (this.channels.get(channel) ?? 0) + 1
    this.channels.set(channel, n)
    if (n === 1) this.send({ action: 'subscribe', channels: [channel] })
    this.connect()
  }

  unsubscribe(channel: string): void {
    const n = (this.channels.get(channel) ?? 0) - 1
    if (n <= 0) {
      this.channels.delete(channel)
      this.send({ action: 'unsubscribe', channels: [channel] })
    } else {
      this.channels.set(channel, n)
    }
  }

  addListener(l: Listener): void {
    this.listeners.add(l)
  }
  removeListener(l: Listener): void {
    this.listeners.delete(l)
  }
}

export const liveFeed = new LiveFeed()
