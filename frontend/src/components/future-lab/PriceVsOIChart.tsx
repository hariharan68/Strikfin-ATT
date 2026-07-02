import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fmtOI } from '../options-lab/OpenInterestChart'
import type { PriceOiPoint } from '../../api/endpoints'

interface Props {
  price: PriceOiPoint[]
  oi: PriceOiPoint[]
  showPrice: boolean
  showOi: boolean
}

// Reference palette: Price = blue solid (left axis), OI = light-gray dashed
// (right axis), on a dark trading-terminal canvas.
const PRICE = '#3b82f6'
const OI = '#9aa3b2'
const CANVAS = '#0a0e16'
const GRID = 'rgba(148,163,184,0.09)'
const AXIS = '#7e8aa0'

// Tight terminal-style padding — the chart, not its chrome, owns the space.
const PAD_TOP = 12
const PAD_BOTTOM = 22
const PAD_LEFT = 50
const PAD_RIGHT = 54

const PRICE_INT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })
const PRICE_DEC = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })

function fmtTime(t: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  }).format(new Date(t)).toUpperCase()
}

function fmtDay(t: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    weekday: 'short', day: '2-digit', month: 'short', year: '2-digit', timeZone: 'Asia/Kolkata',
  }).format(new Date(t))
}

/** OI axis/box ticks without forced trailing zeros: 1Cr · 99.5L · 94.5L. */
function fmtOiTick(n: number): string {
  const a = Math.abs(n)
  const f = (x: number) => String(Number(x.toFixed(2)))
  if (a >= 1e7) return `${f(n / 1e7)}Cr`
  if (a >= 1e5) return `${f(n / 1e5)}L`
  if (a >= 1e3) return `${f(n / 1e3)}K`
  return String(Math.round(n))
}

function niceTicks(min: number, max: number, count = 6): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return [Number.isFinite(max) ? max : 0]
  }
  const span = max - min
  const step0 = span / count
  const pow = Math.pow(10, Math.floor(Math.log10(step0)))
  const n = step0 / pow
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow
  const start = Math.ceil(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 0.01; v += step) out.push(v)
  return out
}

function useSize(ref: React.RefObject<HTMLDivElement | null>): { w: number; h: number } {
  const [s, setS] = useState({ w: 960, h: 520 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect
      if (cr && cr.width > 0 && cr.height > 0) setS({ w: cr.width, h: cr.height })
    })
    ro.observe(el)
    if (el.clientWidth > 0 && el.clientHeight > 0) setS({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [ref])
  return s
}

function domainOf(pts: PriceOiPoint[]): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const p of pts) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1]
  if (lo === hi) return [lo - 1, hi + 1]
  const pad = (hi - lo) * 0.08
  return [lo - pad, hi + pad]
}

/**
 * Future Lab → Price vs OI. A professional dark trading-terminal chart: price
 * (solid blue, left axis) vs total OI (dashed gray, right axis) on a shared time
 * axis, with gridlines, current-value markers, a vertical crosshair and a
 * compact tooltip. Fills its parent container — the chart is the dominant element.
 */
export function PriceVsOIChart({ price, oi, showPrice, showOi }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const { w: W, h: H } = useSize(wrapRef)
  const [hoverT, setHoverT] = useState<number | null>(null)

  const plotW = Math.max(10, W - PAD_LEFT - PAD_RIGHT)
  const plotH = Math.max(10, H - PAD_TOP - PAD_BOTTOM)

  const ms = (iso: string) => new Date(iso).getTime()

  const { tMin, tMax } = useMemo(() => {
    const all = [...price, ...oi].map((p) => ms(p.t)).filter(Number.isFinite)
    if (all.length === 0) return { tMin: 0, tMax: 1 }
    const lo = Math.min(...all), hi = Math.max(...all)
    return { tMin: lo, tMax: hi === lo ? lo + 1 : hi }
  }, [price, oi])

  const [pMin, pMax] = useMemo(() => domainOf(price), [price])
  const [oMin, oMax] = useMemo(() => domainOf(oi), [oi])

  const xAt = (t: number) => PAD_LEFT + ((t - tMin) / (tMax - tMin || 1)) * plotW
  const yPrice = (v: number) => PAD_TOP + plotH - ((v - pMin) / (pMax - pMin || 1)) * plotH
  const yOi = (v: number) => PAD_TOP + plotH - ((v - oMin) / (oMax - oMin || 1)) * plotH

  const linePath = (pts: PriceOiPoint[], proj: (v: number) => number) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(ms(p.t)).toFixed(1)} ${proj(p.v).toFixed(1)}`).join(' ')

  const priceD = useMemo(() => linePath(price, yPrice), [price, W, H, pMin, pMax, tMin, tMax]) // eslint-disable-line react-hooks/exhaustive-deps
  const oiD = useMemo(() => linePath(oi, yOi), [oi, W, H, oMin, oMax, tMin, tMax]) // eslint-disable-line react-hooks/exhaustive-deps

  const priceTicks = useMemo(() => niceTicks(pMin, pMax, Math.max(4, Math.round(plotH / 60))), [pMin, pMax, plotH])
  const oiTicks = useMemo(() => niceTicks(oMin, oMax, Math.max(4, Math.round(plotH / 60))), [oMin, oMax, plotH])

  const xLabels = useMemo(() => {
    const k = Math.max(4, Math.min(10, Math.round(plotW / 140)))
    return Array.from({ length: k + 1 }, (_, i) => tMin + ((tMax - tMin) * i) / k)
  }, [tMin, tMax, plotW])

  const lastPrice = price.length ? price[price.length - 1] : null
  const lastOi = oi.length ? oi[oi.length - 1] : null

  const nearest = (pts: PriceOiPoint[], t: number): PriceOiPoint | null => {
    if (pts.length === 0) return null
    let best = pts[0], bestD = Math.abs(ms(pts[0].t) - t)
    for (const p of pts) { const d = Math.abs(ms(p.t) - t); if (d < bestD) { bestD = d; best = p } }
    return best
  }

  const onMove = (e: React.MouseEvent) => {
    const rect = svgRef.current!.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * W
    const frac = (px - PAD_LEFT) / plotW
    if (frac < 0 || frac > 1) { setHoverT(null); return }
    setHoverT(tMin + frac * (tMax - tMin))
  }

  const hp = hoverT != null && showPrice ? nearest(price, hoverT) : null
  const ho = hoverT != null && showOi ? nearest(oi, hoverT) : null
  const hx = hoverT != null ? xAt(hoverT) : 0
  const tipT = hp?.t ?? ho?.t
  const tipFlip = hx > PAD_LEFT + plotW * 0.62

  const hasData = price.length > 0 || oi.length > 0

  return (
    <div ref={wrapRef} className="relative h-full w-full" style={{ background: CANVAS }}>
      {!hasData ? (
        <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
          No intraday data yet for this session.
        </div>
      ) : (
        <svg
          ref={svgRef}
          width={W}
          height={H}
          className="block"
          style={{ cursor: 'crosshair' }}
          onMouseMove={onMove}
          onMouseLeave={() => setHoverT(null)}
          role="img"
          aria-label="Future price versus open interest"
        >
          {/* gridlines + left (price) axis */}
          {priceTicks.map((t) => {
            const y = yPrice(t)
            if (y < PAD_TOP - 1 || y > PAD_TOP + plotH + 1) return null
            return (
              <g key={`p${t}`}>
                <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={y} y2={y} stroke={GRID} strokeWidth={1} />
                <text x={PAD_LEFT - 6} y={y + 3} textAnchor="end" fontSize={10} fill={showPrice ? '#9bb6e6' : AXIS}>
                  {PRICE_INT.format(t)}
                </text>
              </g>
            )
          })}

          {/* right (OI) axis */}
          {oiTicks.map((t) => {
            const y = yOi(t)
            if (y < PAD_TOP - 1 || y > PAD_TOP + plotH + 1) return null
            return (
              <text key={`o${t}`} x={PAD_LEFT + plotW + 6} y={y + 3} fontSize={10} fill={showOi ? AXIS : AXIS}>
                {fmtOiTick(t)}
              </text>
            )
          })}

          {/* x-axis time labels (+ a day marker near the end) */}
          {xLabels.map((t, k) => (
            <text
              key={`x${k}`}
              x={Math.max(PAD_LEFT, Math.min(PAD_LEFT + plotW, xAt(t)))}
              y={H - 8}
              fontSize={10}
              fill={AXIS}
              textAnchor={k === 0 ? 'start' : k === xLabels.length - 1 ? 'end' : 'middle'}
            >
              {fmtTime(t)}
            </text>
          ))}
          {hasData && (
            <text x={PAD_LEFT + plotW} y={H - 8} fontSize={10} fill={AXIS} textAnchor="end" opacity={0}>
              {fmtDay(tMax)}
            </text>
          )}

          {/* OI line — dashed, right axis */}
          {showOi && oi.length > 0 && (
            <path d={oiD} fill="none" stroke={OI} strokeWidth={1.25} strokeDasharray="4 3" opacity={0.85} strokeLinejoin="round" />
          )}

          {/* current-price marker line (faint) */}
          {showPrice && lastPrice && (
            <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={yPrice(lastPrice.v)} y2={yPrice(lastPrice.v)} stroke={PRICE} strokeWidth={1} strokeDasharray="2 3" opacity={0.25} />
          )}

          {/* Price line — solid, left axis */}
          {showPrice && price.length > 0 && (
            <path d={priceD} fill="none" stroke={PRICE} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
          )}

          {/* crosshair + hovered points */}
          {hoverT != null && (hp || ho) && (
            <>
              <line x1={hx} x2={hx} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="3 3" opacity={0.45} />
              {hp && <circle cx={xAt(ms(hp.t))} cy={yPrice(hp.v)} r={3.5} fill={PRICE} stroke={CANVAS} strokeWidth={1.5} />}
              {ho && <circle cx={xAt(ms(ho.t))} cy={yOi(ho.v)} r={3.5} fill="#e2e8f0" stroke={CANVAS} strokeWidth={1.5} />}
            </>
          )}

          {/* current-value boxes — price (left, slate) · OI (right, blue) */}
          {showPrice && lastPrice && (
            <g transform={`translate(0, ${Math.max(PAD_TOP + 6, Math.min(PAD_TOP + plotH - 6, yPrice(lastPrice.v)))})`}>
              <rect x={0} y={-8} width={PAD_LEFT - 2} height={16} rx={2} fill="#334155" />
              <text x={(PAD_LEFT - 2) / 2} y={3.5} textAnchor="middle" fontSize={10} fontWeight={600} fill="#fff">
                {PRICE_DEC.format(lastPrice.v)}
              </text>
            </g>
          )}
          {showOi && lastOi && (
            <g transform={`translate(${PAD_LEFT + plotW + 2}, ${Math.max(PAD_TOP + 6, Math.min(PAD_TOP + plotH - 6, yOi(lastOi.v)))})`}>
              <rect x={0} y={-8} width={PAD_RIGHT - 2} height={16} rx={2} fill={PRICE} />
              <text x={(PAD_RIGHT - 2) / 2} y={3.5} textAnchor="middle" fontSize={10} fontWeight={600} fill="#fff">
                {fmtOiTick(lastOi.v)}
              </text>
            </g>
          )}
        </svg>
      )}

      {/* tooltip */}
      {hoverT != null && (hp || ho) && tipT && (
        <div
          className="pointer-events-none absolute z-20 min-w-[150px] rounded border border-slate-700 bg-slate-900/95 px-2.5 py-1.5 text-[11px] text-slate-100 shadow-lg"
          style={{ top: 8, left: tipFlip ? hx - 162 : hx + 12 }}
        >
          <div className="mb-1 font-semibold text-slate-300">{fmtDay(ms(tipT))}, {fmtTime(ms(tipT))}</div>
          {hp && (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-slate-400"><span className="inline-block h-1.5 w-2.5 rounded-sm" style={{ background: PRICE }} />Price</span>
              <span className="font-semibold text-white">{PRICE_DEC.format(hp.v)}</span>
            </div>
          )}
          {ho && (
            <div className="mt-0.5 flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-slate-400"><span className="inline-block h-1.5 w-2.5 rounded-sm" style={{ background: OI }} />OI</span>
              <span className="font-semibold text-white">{fmtOI(ho.v, false, 1)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
