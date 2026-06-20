import { useMemo, useState } from 'react'
import { formatCompact, formatInt, formatSigned } from '../../lib/format'

export interface StrikeBar {
  strike: number
  putChange: number
  callChange: number
  putOi: number
  callOi: number
}

interface OIChangeChartProps {
  bars: StrikeBar[]
  /** 'change' = OI Change view, 'oi' = absolute Open Interest view. */
  mode: 'change' | 'oi'
  /** Overlay total OI as hollow bars (only meaningful in 'change' mode). */
  showOi: boolean
  spot?: number
  atmStrike?: number
}

const PUT = '#10b981' // emerald-500
const PUT_DARK = '#059669' // emerald-600
const CALL = '#f43f5e' // rose-500
const CALL_DARK = '#e11d48' // rose-600

// Layout constants (px, 1:1 — kept inside a horizontal scroll container).
const H = 372
const PAD_TOP = 22
const PAD_BOTTOM = 46
const PAD_LEFT = 54
const PAD_RIGHT = 18
const GROUP_W = 50

/** Round up to a "nice" axis maximum (1, 2, 2.5, 5 × 10ⁿ). */
function niceCeil(x: number): number {
  if (x <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(x)))
  const n = x / pow
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * pow
}

export function OIChangeChart({ bars, mode, showOi, spot, atmStrike }: OIChangeChartProps) {
  const [hover, setHover] = useState<number | null>(null)

  const layout = useMemo(() => {
    const n = bars.length
    const width = PAD_LEFT + PAD_RIGHT + n * GROUP_W
    const plotH = H - PAD_TOP - PAD_BOTTOM

    const useOiScale = mode === 'oi' || showOi
    const maxVal = useOiScale
      ? Math.max(1, ...bars.flatMap((b) => [b.putOi, b.callOi]))
      : Math.max(1, ...bars.flatMap((b) => [Math.abs(b.putChange), Math.abs(b.callChange)]))
    const axisMax = niceCeil(maxVal)

    const yOf = (v: number) => PAD_TOP + plotH - (Math.min(v, axisMax) / axisMax) * plotH
    const groupX = (i: number) => PAD_LEFT + i * GROUP_W
    const groupCenter = (i: number) => groupX(i) + GROUP_W / 2

    let spotX: number | null = null
    if (spot !== undefined && n > 1) {
      for (let i = 0; i < n - 1; i++) {
        if (spot >= bars[i].strike && spot <= bars[i + 1].strike) {
          const f = (spot - bars[i].strike) / (bars[i + 1].strike - bars[i].strike || 1)
          spotX = groupCenter(i) + f * (groupCenter(i + 1) - groupCenter(i))
          break
        }
      }
      if (spotX === null) spotX = spot < bars[0].strike ? groupCenter(0) : groupCenter(n - 1)
    }

    const atmIndex = atmStrike !== undefined ? bars.findIndex((b) => b.strike === atmStrike) : -1
    const ticks = Array.from({ length: 6 }, (_, i) => (axisMax / 5) * i)
    return { width, plotH, axisMax, yOf, groupX, groupCenter, spotX, ticks, atmIndex }
  }, [bars, mode, showOi, spot, atmStrike])

  const { width, axisMax, yOf, groupX, groupCenter, spotX, ticks, atmIndex } = layout
  const baseY = PAD_TOP + (H - PAD_TOP - PAD_BOTTOM)
  const barW = (GROUP_W - 14) / 2
  const labelEvery = bars.length > 22 ? 2 : 1

  function ValueBar({
    x,
    value,
    oi,
    color,
    colorDark,
    grad,
  }: {
    x: number
    value: number
    oi: number
    color: string
    colorDark: string
    grad: string
  }) {
    const increase = value >= 0 || mode === 'oi'
    const mag = mode === 'oi' ? oi : Math.abs(value)
    const top = yOf(mag)
    const h = Math.max(increase ? 2 : 0, baseY - top)
    return (
      <g>
        {mode === 'change' && showOi && (
          <rect
            x={x}
            y={yOf(oi)}
            width={barW}
            height={Math.max(0, baseY - yOf(oi))}
            fill={color}
            opacity={0.1}
            rx={2}
          />
        )}
        <rect
          x={x}
          y={top}
          width={barW}
          height={h}
          fill={increase ? `url(#${grad})` : 'white'}
          stroke={increase ? colorDark : color}
          strokeWidth={increase ? 0 : 1.5}
          rx={2}
        />
      </g>
    )
  }

  const hoveredBar = hover !== null ? bars[hover] : null

  return (
    <div className="relative overflow-x-auto pb-1">
      <svg width={width} height={H} className="block" role="img" aria-label="OI by strike">
        <defs>
          <linearGradient id="putGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PUT} stopOpacity={0.95} />
            <stop offset="100%" stopColor={PUT} stopOpacity={0.62} />
          </linearGradient>
          <linearGradient id="callGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CALL} stopOpacity={0.95} />
            <stop offset="100%" stopColor={CALL} stopOpacity={0.62} />
          </linearGradient>
        </defs>

        {/* ATM column highlight */}
        {atmIndex >= 0 && (
          <rect
            x={groupX(atmIndex)}
            y={PAD_TOP - 6}
            width={GROUP_W}
            height={baseY - PAD_TOP + 6}
            className="fill-primary-500"
            opacity={0.06}
          />
        )}

        {/* Hover column */}
        {hover !== null && (
          <rect
            x={groupX(hover)}
            y={PAD_TOP - 6}
            width={GROUP_W}
            height={baseY - PAD_TOP + 6}
            className="fill-slate-400"
            opacity={0.08}
          />
        )}

        {/* Gridlines + y-axis labels */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={PAD_LEFT}
              x2={width - PAD_RIGHT}
              y1={yOf(t)}
              y2={yOf(t)}
              stroke="#eef2f6"
              strokeWidth={1}
            />
            <text x={PAD_LEFT - 10} y={yOf(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
              {t === 0 ? '0' : formatCompact(t)}
            </text>
          </g>
        ))}

        {/* Spot marker */}
        {spotX !== null && (
          <g>
            <line
              x1={spotX}
              x2={spotX}
              y1={PAD_TOP - 2}
              y2={baseY}
              stroke="#334155"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            {spot !== undefined && (
              <g>
                <rect x={spotX - 36} y={PAD_TOP - 20} width={72} height={16} rx={4} className="fill-slate-800" />
                <text x={spotX} y={PAD_TOP - 8} textAnchor="middle" className="fill-white text-[10px] font-semibold">
                  {formatInt(Math.round(spot))}
                </text>
              </g>
            )}
          </g>
        )}

        {/* Bars + hover hit areas + strike labels */}
        {bars.map((b, i) => {
          const gx = groupX(i)
          const putX = gx + 5
          const callX = putX + barW + 4
          const isAtm = i === atmIndex
          return (
            <g key={b.strike}>
              <ValueBar x={putX} value={b.putChange} oi={b.putOi} color={PUT} colorDark={PUT_DARK} grad="putGrad" />
              <ValueBar x={callX} value={b.callChange} oi={b.callOi} color={CALL} colorDark={CALL_DARK} grad="callGrad" />
              <rect
                x={gx}
                y={PAD_TOP - 6}
                width={GROUP_W}
                height={baseY - PAD_TOP + 6}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover((h) => (h === i ? null : h))}
              />
              {i % labelEvery === 0 && (
                <text
                  x={groupCenter(i)}
                  y={baseY + 16}
                  textAnchor="middle"
                  className={isAtm ? 'fill-primary-700 text-[10px] font-bold' : 'fill-slate-500 text-[10px]'}
                >
                  {b.strike}
                </text>
              )}
            </g>
          )
        })}

        <line x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={baseY} y2={baseY} stroke="#cbd5e1" strokeWidth={1} />
      </svg>

      {/* Tooltip */}
      {hoveredBar && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-lg backdrop-blur"
          style={{ left: groupCenter(hover!), top: 6 }}
        >
          <div className="mb-1.5 flex items-center justify-between gap-3 font-semibold text-slate-800">
            <span>Strike {hoveredBar.strike}</span>
            {hoveredBar.strike === atmStrike && (
              <span className="rounded bg-primary-100 px-1 text-[9px] font-bold text-primary-700">ATM</span>
            )}
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 tabular-nums">
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2 w-2 rounded-sm" style={{ background: PUT }} /> Put OI
            </span>
            <span className="text-right text-slate-700">{formatInt(hoveredBar.putOi)}</span>
            <span className="pl-3.5 text-slate-400">change</span>
            <span className="text-right text-slate-600">{formatSigned(hoveredBar.putChange, 0)}</span>
            <span className="flex items-center gap-1.5 text-slate-500">
              <span className="h-2 w-2 rounded-sm" style={{ background: CALL }} /> Call OI
            </span>
            <span className="text-right text-slate-700">{formatInt(hoveredBar.callOi)}</span>
            <span className="pl-3.5 text-slate-400">change</span>
            <span className="text-right text-slate-600">{formatSigned(hoveredBar.callChange, 0)}</span>
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-xs text-slate-500">
        <LegendSwatch color={PUT} label="Put" filled />
        <LegendSwatch color={CALL} label="Call" filled />
        <span className="h-3 w-px bg-slate-200" />
        <span className="text-slate-400">Solid = increase</span>
        <LegendSwatch color="#94a3b8" label="Hollow = decrease" />
        {mode === 'change' && showOi && <span className="text-slate-400">Faint band = total OI</span>}
      </div>
    </div>
  )
}

function LegendSwatch({ color, label, filled }: { color: string; label: string; filled?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-3 w-3 rounded-sm"
        style={{ backgroundColor: filled ? color : 'transparent', border: `1.5px solid ${color}` }}
      />
      {label}
    </span>
  )
}
