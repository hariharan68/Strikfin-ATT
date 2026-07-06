import { Loader2 } from 'lucide-react'
import { PlanCard } from '../PlanCard'
import { useFetch } from '../../../lib/useFetch'
import { getPlan } from '../../../api/endpoints'

export function MyPlansPanel() {
  const { data: plan, loading, error } = useFetch(getPlan, [])

  if (loading) {
    return (
      <div className="stk-card" style={{ display: 'flex', justifyContent: 'center', padding: 32 }}>
        <Loader2 size={22} className="stk-spin" style={{ color: 'var(--stk-accent)' }} />
      </div>
    )
  }

  if (error || !plan) {
    return (
      <div className="stk-card" style={{ color: 'var(--stk-muted)' }}>
        Could not load your plan{error ? `: ${error}` : ''}.
      </div>
    )
  }

  return (
    <div className="stk-stack">
      <PlanCard plan={plan} />
    </div>
  )
}
