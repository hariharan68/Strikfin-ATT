import { Check, X } from 'lucide-react'
import type { PlanInfo } from '../../api/endpoints'

/** Human labels for known limit keys; unknown keys fall back to the raw key. */
const LIMIT_LABELS: Record<string, string> = {
  watchlists: 'Watchlists',
  alerts: 'Alerts',
  api_keys: 'API keys',
  live_data: 'Live market data',
}

function formatPrice(priceInrPaise: number): string {
  if (priceInrPaise <= 0) return 'Free'
  return `₹${(priceInrPaise / 100).toLocaleString('en-IN')}/mo`
}

function formatLimit(value: number | boolean): string {
  if (typeof value === 'boolean') return value ? '✓' : '✗'
  if (value < 0) return 'Unlimited'
  return value.toLocaleString('en-IN')
}

export function PlanCard({ plan }: { plan: PlanInfo }) {
  const price = formatPrice(plan.price_inr)
  const entries = Object.entries(plan.limits)

  return (
    <div className="stk-card stk-plan">
      <div className="stk-plan__top">
        <div>
          <div className="stk-plan__name">{plan.name}</div>
          {plan.renewal_date ? (
            <div className="stk-plan__renew">
              Renews <b>{new Date(plan.renewal_date).toLocaleDateString('en-IN')}</b>
            </div>
          ) : (
            <div className="stk-plan__renew">No renewal — active</div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="stk-plan__price">{price}</div>
        </div>
      </div>

      {entries.length > 0 && (
        <ul className="stk-plan__features">
          {entries.map(([key, value]) => {
            const label = LIMIT_LABELS[key] ?? key
            const isBool = typeof value === 'boolean'
            const on = isBool ? (value as boolean) : true
            return (
              <li key={key} className="stk-plan__feature">
                <span
                  className={on ? 'stk-plan__feature-on' : 'stk-plan__feature-off'}
                  aria-hidden
                >
                  {on ? <Check size={14} /> : <X size={14} />}
                </span>
                <span className="stk-plan__feature-label">{label}</span>
                {!isBool && (
                  <span className="stk-plan__feature-value">{formatLimit(value)}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
