import { cn } from '../../../lib/format'
import { useFyersConnect } from '../../../lib/useFyersConnect'

interface StaticBroker {
  id: string
  name: string
  logo: string
}

/** Non-Fyers brokers are display-only stubs until their OAuth flows exist. */
const OTHER_BROKERS: StaticBroker[] = [
  { id: 'zerodha', name: 'Zerodha Kite', logo: '🅚' },
  { id: 'upstox', name: 'Upstox', logo: '🆄' },
]

export function BrokerConnectPanel() {
  const fyers = useFyersConnect()

  const handleConnectStub = (broker: StaticBroker) => {
    // Real OAuth flow to be implemented separately.
    console.info(`Connect broker requested: ${broker.id}`)
  }

  return (
    <div className="stk-card">
      <h3 className="stk-section-title">Brokers</h3>
      <div className="stk-list">
        {/* Fyers — the one wired to live endpoints */}
        <BrokerRow
          logo="⚡"
          name="Fyers"
          connected={fyers.connected}
          statusText={
            fyers.loadingStatus
              ? 'Checking…'
              : fyers.connected
                ? `Connected${fyers.status?.app_id ? ` · ${fyers.status.app_id}` : ''}`
                : fyers.hasToken
                  ? 'Token expired'
                  : 'Not connected'
          }
          action={
            fyers.connected ? (
              <button
                type="button"
                className="stk-btn stk-btn--danger"
                disabled={fyers.disconnecting}
                onClick={() => void fyers.disconnect()}
              >
                {fyers.disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </button>
            ) : (
              <button
                type="button"
                className="stk-btn stk-btn--primary"
                disabled={fyers.phase === 'connecting'}
                onClick={() => void fyers.connect()}
              >
                {fyers.phase === 'connecting' ? 'Waiting…' : 'Connect'}
              </button>
            )
          }
        />

        {/* Static brokers — not connected */}
        {OTHER_BROKERS.map((b) => (
          <BrokerRow
            key={b.id}
            logo={b.logo}
            name={b.name}
            connected={false}
            statusText="Not connected"
            action={
              <button
                type="button"
                className="stk-btn stk-btn--primary"
                onClick={() => handleConnectStub(b)}
              >
                Connect
              </button>
            }
          />
        ))}
      </div>
    </div>
  )
}

function BrokerRow({
  logo,
  name,
  connected,
  statusText,
  action,
}: {
  logo: string
  name: string
  connected: boolean
  statusText: string
  action: React.ReactNode
}) {
  return (
    <div className="stk-broker-row">
      <span className="stk-broker-row__logo">{logo}</span>
      <div className="stk-broker-row__meta">
        <div className="stk-broker-row__name">{name}</div>
        <div className="stk-broker-row__status">
          <span
            className={cn('stk-status-dot', connected ? 'stk-status-dot--on' : 'stk-status-dot--off')}
          />
          {statusText}
        </div>
      </div>
      {action}
    </div>
  )
}
