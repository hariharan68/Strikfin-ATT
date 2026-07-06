import { Check } from 'lucide-react'
import { cn } from '../../../lib/format'
import { useToast } from '../../ui/Toast'
import { getErrorMessage } from '../../../api/client'
import { updatePreferences, type CallPutScheme } from '../../../api/endpoints'
import { useTheme, type Theme } from '../../../lib/useTheme'
import { setPreferences, usePreferences } from '../../../lib/usePreferences'

export function GlobalSettingsPanel() {
  const toast = useToast()
  // Shared store — seeded from the server at login; charts read the same source.
  const { showChartTooltip: showTooltip, callPutScheme: colorScheme } = usePreferences()

  // Optimistic persist helper: apply to the store, PUT, revert + toast on failure.
  const persist = async (
    apply: () => void,
    revert: () => void,
    payload: Parameters<typeof updatePreferences>[0],
  ) => {
    apply()
    try {
      await updatePreferences(payload)
    } catch (e) {
      revert()
      toast.error(getErrorMessage(e, 'Could not save preference'))
    }
  }

  const onToggleTooltip = () => {
    const next = !showTooltip
    void persist(
      () => setPreferences({ showChartTooltip: next }),
      () => setPreferences({ showChartTooltip: !next }),
      { show_chart_tooltip: next },
    )
  }

  const onSelectScheme = (next: CallPutScheme) => {
    if (next === colorScheme) return
    const prev = colorScheme
    void persist(
      () => setPreferences({ callPutScheme: next }),
      () => setPreferences({ callPutScheme: prev }),
      { call_put_scheme: next },
    )
  }

  return (
    <div className="stk-stack">
      {/* Chart tooltip toggle */}
      <section className="stk-card">
        <h3 className="stk-section-title">Chart</h3>
        <div className="stk-toggle-row">
          <div>
            <div className="stk-toggle-row__title">Show chart tooltip</div>
            <div className="stk-toggle-row__desc">
              Reveal price &amp; OI details on chart hover
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showTooltip}
            aria-label="Show chart tooltip"
            onClick={onToggleTooltip}
            className={cn('stk-switch', showTooltip && 'is-on')}
          >
            <span className="stk-switch__thumb" />
          </button>
        </div>
      </section>

      {/* Call/Put colour scheme */}
      <section className="stk-card">
        <h3 className="stk-section-title">Call / Put colour</h3>
        <CallPutSelector value={colorScheme} onSelect={onSelectScheme} />
      </section>

      {/* Theme picker */}
      <section className="stk-card">
        <h3 className="stk-section-title">Appearance — theme</h3>
        <ThemeGrid />
      </section>
    </div>
  )
}

// ── Call/Put selector ─────────────────────────────────────────
interface ColorOption {
  id: CallPutScheme
  label: string
  /** [CALL dot colour, PUT dot colour]. */
  dots: [string, string]
}

const COLOR_OPTIONS: ColorOption[] = [
  { id: 'classic', label: 'Classic', dots: ['var(--stk-call)', 'var(--stk-put)'] },
  { id: 'inverted', label: 'Inverted', dots: ['var(--stk-put)', 'var(--stk-call)'] },
]

function CallPutSelector({
  value,
  onSelect,
}: {
  value: CallPutScheme
  onSelect: (v: CallPutScheme) => void
}) {
  return (
    <div className="stk-radio-grid">
      {COLOR_OPTIONS.map((opt) => {
        const selected = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(opt.id)}
            className={cn('stk-radio-card', selected && 'is-selected')}
          >
            <div className="stk-radio-card__name">
              {opt.label}
              {selected && <Check size={15} className="stk-check" />}
            </div>
            <div className="stk-radio-card__preview">
              <span className="stk-legend">
                <span className="stk-dot" style={{ background: opt.dots[0] }} />
                CALL
              </span>
              <span className="stk-legend">
                <span className="stk-dot" style={{ background: opt.dots[1] }} />
                PUT
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ── Theme picker grid ─────────────────────────────────────────
interface ThemeOption {
  id: Theme
  name: string
  description: string
  /** [preview surface, panel, accent bar]. */
  swatches: [string, string, string]
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: 'classic',
    name: 'Classic Blue',
    description: 'Light & crisp',
    swatches: ['#f0f4f8', '#ffffff', '#2350e8'],
  },
  {
    id: 'warm',
    name: 'Warm Cream',
    description: 'Easy on the eyes',
    swatches: ['#f1e8df', '#fbf8f4', '#c0561f'],
  },
  {
    id: 'dark',
    name: 'Dark Mode',
    description: 'Low-light slate',
    swatches: ['#0a0e16', '#141b27', '#2350e8'],
  },
  {
    id: 'terminal',
    name: 'Classic Dark',
    description: 'Pure black + terracotta',
    swatches: ['#0a0c10', '#14171c', '#e2562a'],
  },
]

function ThemeGrid() {
  const { theme, setTheme } = useTheme()
  const toast = useToast()

  const onPick = (id: Theme) => {
    if (id === theme) return
    const prev = theme
    setTheme(id) // instant local apply + localStorage
    // Persist server-side; revert on failure.
    void updatePreferences({ theme: id }).catch((e) => {
      setTheme(prev)
      toast.error(getErrorMessage(e, 'Could not save theme'))
    })
  }

  return (
    <div className="stk-theme-grid">
      {THEME_OPTIONS.map((opt) => {
        const active = theme === opt.id
        const [surface, panel, accent] = opt.swatches
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onPick(opt.id)}
            className={cn('stk-theme-card', active && 'is-active')}
          >
            {active && <span className="stk-active-pill">ACTIVE</span>}
            <div className="stk-theme-preview" style={{ background: surface }}>
              <div className="stk-theme-preview__bar" style={{ background: accent }} />
              <div className="stk-theme-preview__panel" style={{ background: panel }}>
                <div className="stk-theme-preview__line" style={{ width: '75%' }} />
                <div className="stk-theme-preview__line" style={{ width: '50%' }} />
              </div>
            </div>
            <div className="stk-theme-card__name">{opt.name}</div>
            <div className="stk-theme-card__desc">{opt.description}</div>
          </button>
        )
      })}
    </div>
  )
}
