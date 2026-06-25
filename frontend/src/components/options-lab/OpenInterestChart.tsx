import { useMemo, useState } from 'react'
import { formatInt } from '../../lib/format'

// ── Types ──────────────────────────────────────────────────────────
export interface OIBar {
  strike: number
  callOpen: number
  callNow: number
  callChg: number
  callChgPct: number
  putOpen: number
  putNow: number
  putChg: number
  putChgPct: number
}

export type OIMode = 'change_total' | 'change' | 'total'

interface Props {
  bars: OIBar[]
  mode: OIMode
  spot?: number
  atmStrike?: number
  maxPain?: number
  lotSize: number
  showLot: boolean
  /** Tooltip labels, e.g. "9:15 AM" and "12:44 PM". */
  openLabel: string
  nowLabel: string
}

// Reference palette: Call = green, Put = red.
const CALL = '#16a34a' // green-600
const PUT = '#ef4444' // red-500

// Layout (px; chart lives inside a horizontal scroll container)
const H = 392
const PAD_TOP = 30
const PAD_BOTTOM = 44
const PAD_LEFT = 56
const PAD_RIGHT = 16
const GROUP_W = 54

function niceCeil(x: number): number {
  if (x <= 0) return 1
  const pow = Math.pow(10, Math.floor(Math.log10(x)))
  const n = x / pow
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10
  return m * pow
}

/** Indian L/Cr formatting with 2 decimals (or lots when showLot). */
export function fmtOI(n: number, showLot: boolean, lot: number): string {
  if (showLot) return formatInt(Math.round(n / Math.max(1, lot)))
  const a = Math.abs(n)
  if (a >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`
  if (a >= 1e5) return `${(n / 1e5).toFixed(2)}L`
  if (a >= 1e3) return `${(n / 1e3).toFixed(2)}K`
  return String(Math.round(n))
}

function fmtSignedOI(n: number, showLot: boolean, lot: number): string {
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${fmtOI(Math.abs(n), showLot, lot)}`
}

export function OpenInterestChart({
  bars,
  mode,
  spot,
  atmStrike,
  maxPain,
  lotSize,
  showLot,
  openLabel,
  nowLabel,
}: Props) {
  const [hover, setHover] = useState<number | null>(null)

  // Scale OI to lots if requested — keeps the axis consistent with the labels.
  const sc = (v: number) => (showLot ? v / Math.max(1, lotSize) : v)

  const layout = useMemo(() => {
    const n = bars.length
    const width = PAD_LEFT + PAD_RIGHT + n * GROUP_W
    const plotH = H - PAD_TOP - PAD_BOTTOM

    const maxVal =
      mode === 'change'
        ? Math.max(1, ...bars.flatMap((b) => [Math.abs(sc(b.callChg)), Math.abs(sc(b.putChg))]))
        : Math.max(
            1,
            ...bars.flatMap((b) => [
              sc(b.callNow),
              sc(b.callOpen),
              sc(b.putNow),
              sc(b.putOpen),
            ]),
          )
    const axisMax = niceCeil(maxVal)

    const yOf = (v: number) => PAD_TOP + plotH - (Math.min(v, axisMax) / axisMax) * plotH
    const groupX = (i: number) => PAD_LEFT + i * GROUP_W
    const groupCenter = (i: number) => groupX(i) + GROUP_W / 2

    // Map a price (spot / max pain) to an x position by interpolating strikes.
    const priceX = (price?: number): number | null => {
      if (price === undefined || n === 0) return null
      if (price <= bars[0].strike) return groupCenter(0)
      if (price >= bars[n - 1].strike) return groupCenter(n - 1)
      for (let i = 0; i < n - 1; i++) {
        if (price >= bars[i].strike && price <= bars[i + 1].strike) {
          const f = (price - bars[i].strike) / (bars[i + 1].strike - bars[i].strike || 1)
          return groupCenter(i) + f * (groupCenter(i + 1) - groupCenter(i))
        }
      }
      return null
    }

    const atmIndex = atmStrike !== undefined ? bars.findIndex((b) => b.strike === atmStrike) : -1
    const ticks = Array.from({ length: 7 }, (_, i) => (axisMax / 6) * i)
    return {
      width,
      axisMax,
      yOf,
      groupX,
      groupCenter,
      spotX: priceX(spot),
      maxPainX: priceX(maxPain),
      ticks,
      atmIndex,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, mode, spot, maxPain, atmStrike, showLot, lotSize])

  const { width, yOf, groupX, groupCenter, spotX, maxPainX, ticks, atmIndex } = layout
  const baseY = PAD_TOP + (H - PAD_TOP - PAD_BOTTOM)
  const barW = (GROUP_W - 16) / 2
  const labelEvery = bars.length > 24 ? 2 : 1

  /** One option-side bar with total+change / change / total rendering. */
  function SideBar({
    x,
    open,
    now,
    color,
    hatchId,
  }: {
    x: number
    open: number
    now: number
    color: string
    hatchId: string
  }) {
    const o = sc(open)
    const c = sc(now)
    const chg = c - o
    const increase = chg >= 0

    if (mode === 'total') {
      const top = yOf(c)
      return <rect x={x} y={top} width={barW} height={Math.max(1, baseY - top)} fill={color} opacity={0.92} rx={2} />
    }

    if (mode === 'change') {
      const mag = Math.abs(chg)
      const top = yOf(mag)
      const h = Math.max(increase ? 2 : 1, baseY - top)
      return (
        <rect
          x={x}
          y={top}
          width={barW}
          height={h}
          fill={increase ? `url(#${hatchId})` : 'transparent'}
          stroke={color}
          strokeWidth={increase ? 0.75 : 1.5}
          rx={2}
        />
      )
    }

    // change_total: solid base + change segment on top (hatch up / outline down)
    const baseTop = yOf(Math.min(o, c))
    const baseH = Math.max(1, baseY - baseTop)
    const segTop = yOf(Math.max(o, c))
    const segH = Math.max(0, baseTop - segTop)
    return (
      <g>
        <rect x={x} y={baseTop} width={barW} height={baseH} fill={color} opacity={0.92} rx={2} />
        {segH > 0.5 && (
          <rect
            x={x}
            y={segTop}
            width={barW}
            height={segH}
            fill={increase ? `url(#${hatchId})` : 'transparent'}
            stroke={color}
            strokeWidth={increase ? 0.75 : 1.5}
            strokeDasharray={increase ? undefined : '3 2'}
            rx={2}
          />
        )}
      </g>
    )
  }

  const hb = hover !== null ? bars[hover] : null
  // Flip the tooltip to the left when hovering the right portion of the chart.
  const tipLeft = hover !== null ? groupCenter(hover) : 0
  const flip = tipLeft > PAD_LEFT + (width - PAD_LEFT) * 0.62

  return (
    <div className="relative overflow-x-auto pb-1">
      <svg width={width} height={H} className="block" role="img" aria-label="Open interest by strike">
        <defs>
          <pattern id="callHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={CALL} opacity={0.18} />
            <line x1="0" y1="0" x2="0" y2="6" stroke={CALL} strokeWidth="2.2" />
          </pattern>
          <pattern id="putHatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" fill={PUT} opacity={0.18} />
            <line x1="0" y1="0" x2="0" y2="6" stroke={PUT} strokeWidth="2.2" />
          </pattern>
        </defs>

        {/* ATM column highlight */}
        {atmIndex >= 0 && (
          <rect
            x={groupX(atmIndex)}
            y={PAD_TOP - 8}
            width={GROUP_W}
            height={baseY - PAD_TOP + 8}
            className="fill-primary-500"
            opacity={0.07}
          />
        )}

        {/* Hover column */}
        {hover !== null && (
          <rect
            x={groupX(hover)}
            y={PAD_TOP - 8}
            width={GROUP_W}
            height={baseY - PAD_TOP + 8}
            className="fill-slate-400"
            opacity={0.1}
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
              stroke="var(--color-slate-100)"
              strokeWidth={1}
            />
            <text x={PAD_LEFT - 8} y={yOf(t) + 3} textAnchor="end" className="fill-slate-400 text-[10px]">
              {t === 0 ? '0' : fmtOI(showLot ? t * lotSize : t, showLot, lotSize)}
            </text>
          </g>
        ))}

        {/* Max Pain line (orange, behind bars) */}
        {maxPainX !== null && (
          <g>
            <line x1={maxPainX} x2={maxPainX} y1={PAD_TOP - 4} y2={baseY} stroke="#f59e0b" strokeWidth={1.25} strokeDasharray="5 3" />
            <g transform={`translate(${maxPainX}, ${PAD_TOP - 14})`}>
              <rect x={-58} y={-9} width={116} height={17} rx={4} fill="#b45309" />
              <text x={0} y={3} textAnchor="middle" className="fill-white text-[10px] font-semibold">
                Max Pain : {maxPain}
              </text>
            </g>
          </g>
        )}

        {/* Spot line (slate dashed) */}
        {spotX !== null && (
          <g>
            <line x1={spotX} x2={spotX} y1={PAD_TOP - 4} y2={baseY} stroke="var(--color-slate-600)" strokeWidth={1.25} strokeDasharray="2 3" />
            {spot !== undefined && (
              <g transform={`translate(${spotX}, ${PAD_TOP + 4})`}>
                <rect x={-46} y={-2} width={92} height={17} rx={4} className="fill-slate-800" />
                <text x={0} y={10} textAnchor="middle" className="fill-white text-[10px] font-semibold">
                  Spot : {Math.round(spot)}
                </text>
              </g>
            )}
          </g>
        )}

        {/* Bars + hover hit areas + strike labels */}
        {bars.map((b, i) => {
          const gx = groupX(i)
          const callX = gx + 6
          const putX = callX + barW + 4
          const isAtm = i === atmIndex
          return (
            <g key={b.strike}>
              <SideBar x={callX} open={b.callOpen} now={b.callNow} color={CALL} hatchId="callHatch" />
              <SideBar x={putX} open={b.putOpen} now={b.putNow} color={PUT} hatchId="putHatch" />
              <rect
                x={gx}
                y={PAD_TOP - 8}
                width={GROUP_W}
                height={baseY - PAD_TOP + 8}
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

        <line x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={baseY} y2={baseY} stroke="var(--color-slate-300)" strokeWidth={1} />
      </svg>

      {/* Tooltip — the priority interaction */}
      {hb && (
        <div
          className="pointer-events-none absolute z-20 w-[230px] rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-2.5 text-xs text-slate-100 shadow-xl backdrop-blur"
          style={{
            left: flip ? tipLeft - 244 : tipLeft + 14,
            top: PAD_TOP,
          }}
        >
          <div className="mb-2 flex items-center justify-between font-semibold">
            <span>Strike: {hb.strike}</span>
            {hb.strike === atmStrike && (
              <span className="rounded bg-primary-500/30 px-1 text-[9px] font-bold text-primary-200">ATM</span>
            )}
          </div>

          <TipBlock
            color={CALL}
            label="Call"
            openLabel={openLabel}
            nowLabel={nowLabel}
            open={hb.callOpen}
            now={hb.callNow}
            chg={hb.callChg}
            chgPct={hb.callChgPct}
            showLot={showLot}
            lot={lotSize}
          />
          <div className="my-2 h-px bg-slate-700" />
          <TipBlock
            color={PUT}
            label="Put"
            openLabel={openLabel}
            nowLabel={nowLabel}
            open={hb.putOpen}
            now={hb.putNow}
            chg={hb.putChg}
            chgPct={hb.putChgPct}
            showLot={showLot}
            lot={lotSize}
          />
        </div>
      )}

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-[11px] text-slate-500">
        <LegendItem color={CALL} kind="solid" label="Call OI" />
        <LegendItem color={CALL} kind="outline" label="Call OI Decrease" />
        <LegendItem color={CALL} kind="hatch" label="Call OI Increase" />
        <LegendItem color={PUT} kind="solid" label="Put OI" />
        <LegendItem color={PUT} kind="outline" label="Put OI Decrease" />
        <LegendItem color={PUT} kind="hatch" label="Put OI Increase" />
      </div>
    </div>
  )
}

function TipBlock({
  color,
  label,
  openLabel,
  nowLabel,
  open,
  now,
  chg,
  chgPct,
  showLot,
  lot,
}: {
  color: string
  label: string
  openLabel: string
  nowLabel: string
  open: number
  now: number
  chg: number
  chgPct: number
  showLot: boolean
  lot: number
}) {
  const up = chg >= 0
  return (
    <div className="space-y-1 tabular-nums">
      <Row
        marker={<span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />}
        left={`${label} OI at ${openLabel}`}
        right={fmtOI(open, showLot, lot)}
      />
      <Row
        marker={
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm border"
            style={{ borderColor: color, background: 'transparent' }}
          />
        }
        left={`${label} OI Chg`}
        right={
          <span className={up ? 'text-emerald-400' : 'text-rose-400'}>
            {fmtSignedOI(chg, showLot, lot)} ({up ? '+' : '−'}
            {Math.abs(chgPct).toFixed(0)}%)
          </span>
        }
      />
      <Row left={`${label} OI at ${nowLabel}`} right={fmtOI(now, showLot, lot)} indent />
    </div>
  )
}

function Row({
  marker,
  left,
  right,
  indent,
}: {
  marker?: React.ReactNode
  left: string
  right: React.ReactNode
  indent?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-slate-300">
        {marker ?? <span className={indent ? 'inline-block w-2.5' : ''} />}
        {left}
      </span>
      <span className="font-semibold text-white">{right}</span>
    </div>
  )
}

function LegendItem({ color, kind, label }: { color: string; kind: 'solid' | 'outline' | 'hatch'; label: string }) {
  const style: React.CSSProperties =
    kind === 'solid'
      ? { background: color }
      : kind === 'outline'
        ? { border: `1.5px solid ${color}`, background: 'transparent' }
        : {
            background: `repeating-linear-gradient(45deg, ${color} 0 2px, transparent 2px 5px)`,
            border: `1px solid ${color}`,
          }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={style} />
      {label}
    </span>
  )
}
