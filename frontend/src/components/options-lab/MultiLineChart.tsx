import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { fmtOI } from './OpenInterestChart'

// ── Types ──────────────────────────────────────────────────────────
export interface LineSeries {
  /** Stable key (contract id or "CALL"/"PUT"). */
  key: string
  label: string
  color: string
  /** y-values aligned to `times`; null = gap (no data at that snapshot). */
  values: (number | null)[]
}

interface Props {
  /** ISO timestamps, one per x-position. */
  times: string[]
  series: LineSeries[]
  /** Optional future/spot price overlay (dashed, drawn on its own left axis). */
  future?: (number | null)[]
  /** Right-axis number formatting. */
  lotSize: number
  showLot: boolean
  /** signed adds +/- and forces a 0 baseline (OI-change chart). */
  signed?: boolean
  /** Hide the future overlay without collapsing its axis (legend eye toggle). */
  showFuture?: boolean
  /**
   * Fixed x-axis domain (ISO timestamps), e.g. 09:15 → 15:30 IST of the trade
   * date. When set, points are placed by *time* (not index) so the axis always
   * covers the full session and the intraday curve builds left-to-right as
   * snapshots accrue. Defaults to the data extent.
   */
  domainStart?: string
  domainEnd?: string
  height?: number
}

// Layout
const PAD_TOP = 16
const PAD_BOTTOM = 38
const FUT = '#94a3b8' // slate-400 dashed future line (visible in both themes)
const MIN_SPAN = 0.04 // smallest zoom window as a fraction of the series

function fmtClock(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  }).format(d)
}

const PRICE_FMT_2 = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Format a price-axis tick with just enough decimals for the tick step.
 * A near-flat future line (e.g. a 2-point proxy session) produces sub-1 steps;
 * rounding those to integers printed the same label on several ticks.
 */
function fmtPriceTick(v: number, step: number): string {
  const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v)
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v))
}

function niceTicks(min: number, max: number, count = 5): number[] {
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

/** Track the wrapper's pixel width so the SVG renders 1 unit = 1px (no distortion). */
function useWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [w, setW] = useState(900)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const cw = entries[0]?.contentRect.width
      if (cw && cw > 0) setW(cw)
    })
    ro.observe(el)
    if (el.clientWidth > 0) setW(el.clientWidth)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/**
 * Responsive multi-line SVG chart with a dual axis (Future price left, OI/Volume
 * right), colored value badges, a hover crosshair + tooltip, and interactive
 * pan/zoom (drag to pan, scroll to zoom, double-click to reset). The visible
 * window is held as fractions of the series so it survives live polling.
 * Dependency-free — no chart library is used anywhere in this repo.
 */
export function MultiLineChart({ times, series, future, lotSize, showLot, signed, showFuture = true, domainStart, domainEnd, height = 360 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const W = useWidth(wrapRef)
  const clipId = useId()

  const [hover, setHover] = useState<number | null>(null)
  // Visible window as [start, end] fractions in [0, 1]. {0,1} = whole session.
  const [view, setView] = useState({ s: 0, e: 1 })
  const drag = useRef<{ px: number; s: number; e: number } | null>(null)

  // Axis space is reserved whenever future data exists, so toggling the line
  // off via the legend doesn't reflow the plot.
  const futAvail = !!future && future.some((v) => v != null)
  const hasFuture = futAvail && showFuture
  const PAD_LEFT = futAvail ? 64 : 12
  const PAD_RIGHT = 66

  const plotW = Math.max(10, W - PAD_LEFT - PAD_RIGHT)
  const plotH = height - PAD_TOP - PAD_BOTTOM
  const n = times.length

  // ── time-based x geometry ──────────────────────────────────────
  // Each point's x-fraction comes from its timestamp within [t0, t1], so gaps
  // in ingestion render as gaps in time — and a fixed session domain keeps the
  // axis at 09:15 → 15:30 even when data covers only part of the day.
  const tms = useMemo(() => times.map((t) => new Date(t).getTime()), [times])
  const t0 = useMemo(() => {
    const d = domainStart ? new Date(domainStart).getTime() : NaN
    return Number.isFinite(d) ? d : (tms[0] ?? 0)
  }, [domainStart, tms])
  const t1 = useMemo(() => {
    const d = domainEnd ? new Date(domainEnd).getTime() : NaN
    return Number.isFinite(d) ? d : (tms[n - 1] ?? 1)
  }, [domainEnd, tms, n])
  const tSpan = Math.max(1, t1 - t0)
  const fracs = useMemo(() => tms.map((t) => clamp((t - t0) / tSpan, 0, 1)), [tms, t0, tSpan])

  const spanF = Math.max(MIN_SPAN, view.e - view.s)
  const xAt = (i: number) => PAD_LEFT + (((fracs[i] ?? 0) - view.s) / spanF) * plotW
  const xToFrac = (px: number) => view.s + ((px - PAD_LEFT) / plotW) * spanF

  // Indices currently visible (with a one-point margin for line continuity).
  const [iStart, iEnd] = useMemo(() => {
    if (n <= 1) return [0, n - 1] as const
    let a = 0
    while (a < n - 1 && fracs[a + 1] < view.s) a++
    let b = n - 1
    while (b > 0 && fracs[b - 1] > view.e) b--
    return [Math.min(a, b), Math.max(a, b)] as const
  }, [view, n, fracs])

  // ── y-domain over the *visible* series only (auto-fit on zoom) ──
  const { yMin, yMax } = useMemo(() => {
    let lo = signed ? 0 : Infinity
    let hi = signed ? 0 : -Infinity
    for (const s of series) {
      for (let i = iStart; i <= iEnd; i++) {
        const v = s.values[i]
        if (v == null) continue
        if (v < lo) lo = v
        if (v > hi) hi = v
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { yMin: 0, yMax: 1 }
    if (lo === hi) { hi = lo + 1; lo = signed ? Math.min(0, lo - 1) : lo - 1 }
    const pad = (hi - lo) * 0.08
    return { yMin: lo - pad, yMax: hi + pad }
  }, [series, signed, iStart, iEnd])

  const futDomain = useMemo(() => {
    if (!hasFuture) return null
    let lo = Infinity
    let hi = -Infinity
    for (let i = iStart; i <= iEnd; i++) {
      const v = future![i]
      if (v == null) continue
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
    if (lo === hi) { hi = lo + 1; lo -= 1 }
    const pad = (hi - lo) * 0.12
    return { lo: lo - pad, hi: hi + pad }
  }, [future, hasFuture, iStart, iEnd])

  const yAt = (v: number) => PAD_TOP + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH
  const yFut = (v: number) =>
    futDomain ? PAD_TOP + plotH - ((v - futDomain.lo) / (futDomain.hi - futDomain.lo || 1)) * plotH : 0

  const linePath = (vals: (number | null)[], proj: (v: number) => number) => {
    let d = ''
    let pen = false
    for (let i = Math.max(0, iStart - 1); i <= Math.min(n - 1, iEnd + 1); i++) {
      const v = vals[i]
      if (v == null) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)} ${proj(v).toFixed(1)} `
      pen = true
    }
    return d.trim()
  }

  const fmtY = (v: number) => (signed && v > 0 ? '+' : '') + fmtOI(v, showLot, lotSize)

  // Precompute path geometry once per data/zoom/size change so the frequent
  // hover & drag re-renders only redraw the crosshair, not every line.
  const seriesD = useMemo(
    () => series.map((s) => linePath(s.values, yAt)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, view, W, height, yMin, yMax, iStart, iEnd, hasFuture, fracs],
  )
  const futureD = useMemo(
    () => (hasFuture && futDomain ? linePath(future!, yFut) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [future, hasFuture, futDomain, view, W, height, iStart, iEnd, fracs],
  )

  const yTicks = useMemo(() => niceTicks(yMin, yMax, 5), [yMin, yMax])
  const futTicks = useMemo(() => (futDomain ? niceTicks(futDomain.lo, futDomain.hi, 5) : []), [futDomain])
  const futStep = futTicks.length > 1 ? futTicks[1] - futTicks[0] : 1
  // Latest visible future value — shown as a persistent pill on the price axis.
  const futLast = useMemo(() => {
    if (!hasFuture || !futDomain) return null
    for (let i = iEnd; i >= 0; i--) {
      const v = future![i]
      if (v != null) return v
    }
    return null
  }, [future, hasFuture, futDomain, iEnd])

  // x-axis ticks at round clock times across the visible window (~7), derived
  // from the time domain — not from data points — so the axis always spans the
  // whole session even when snapshots cover only a slice of it.
  const xTicks = useMemo(() => {
    if (n === 0) return []
    const tA = t0 + view.s * tSpan
    const tB = t0 + view.e * tSpan
    const target = (tB - tA) / 7
    const steps = [1, 2, 5, 10, 15, 30, 60, 90, 120].map((m) => m * 60_000)
    const step = steps.find((s) => s >= target) ?? steps[steps.length - 1]
    const first = Math.ceil(tA / step) * step
    const out: number[] = []
    for (let t = first; t <= tB; t += step) out.push(t)
    return out
  }, [n, t0, tSpan, view])
  const xOfTime = (t: number) => PAD_LEFT + (((t - t0) / tSpan - view.s) / spanF) * plotW

  // ── right-edge value badges (value at the right edge of the window) ──
  const badges = useMemo(() => {
    const lastV = iEnd
    const raw = series
      .map((s) => {
        for (let i = lastV; i >= 0; i--) {
          const v = s.values[i]
          if (v != null) return { key: s.key, color: s.color, text: fmtY(v), y: yAt(v) }
        }
        return null
      })
      .filter(Boolean) as { key: string; color: string; text: string; y: number }[]
    raw.sort((a, b) => a.y - b.y)
    const gap = 16
    for (let i = 1; i < raw.length; i++) {
      if (raw[i].y - raw[i - 1].y < gap) raw[i].y = raw[i - 1].y + gap
    }
    const bottom = PAD_TOP + plotH
    for (let i = raw.length - 1; i >= 0; i--) {
      if (raw[i].y > bottom) raw[i].y = bottom - (raw.length - 1 - i) * gap
    }
    return raw
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, yMin, yMax, plotH, showLot, lotSize, signed, view, n, iEnd])

  // ── interaction: pan (drag), zoom (wheel), reset (double-click) ──
  const pxFromClient = (clientX: number) => {
    const rect = svgRef.current!.getBoundingClientRect()
    return ((clientX - rect.left) / rect.width) * W
  }

  const onDown = (e: React.MouseEvent) => {
    if (n <= 1) return
    drag.current = { px: pxFromClient(e.clientX), s: view.s, e: view.e }
    setHover(null)
  }

  const onMove = (e: React.MouseEvent) => {
    if (n === 0) return
    const px = pxFromClient(e.clientX)
    if (drag.current) {
      const snap = drag.current
      const snapSpan = snap.e - snap.s
      const dF = ((px - snap.px) / plotW) * snapSpan
      const s = clamp(snap.s - dF, 0, 1 - snapSpan)
      setView({ s, e: s + snapSpan })
      return
    }
    // Snap the crosshair to the nearest point *in time* within the window.
    const fi = xToFrac(px)
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(fracs[i] - fi)
      if (d < bestD) { bestD = d; best = i }
    }
    setHover(best)
  }

  const endDrag = () => { drag.current = null }

  // Native non-passive wheel listener so we can preventDefault page scroll.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (n <= 1) return
      e.preventDefault()
      const fc = xToFrac(pxFromClient(e.clientX))
      const factor = e.deltaY < 0 ? 0.82 : 1 / 0.82
      const newSpan = clamp(spanF * factor, MIN_SPAN, 1)
      const ratio = spanF > 0 ? (fc - view.s) / spanF : 0.5
      let s = clamp(fc - ratio * newSpan, 0, 1 - newSpan)
      setView({ s, e: s + newSpan })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  })

  const zoomed = view.s > 0.0001 || view.e < 0.9999

  if (n === 0) {
    return (
      <div ref={wrapRef} className="flex items-center justify-center text-sm text-slate-400" style={{ height }}>
        No intraday history yet.
      </div>
    )
  }

  const hx = hover != null ? xAt(hover) : 0
  const futHover = hasFuture && hover != null ? future![hover] : null
  const dragging = drag.current != null

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg
        ref={svgRef}
        width={W}
        height={height}
        className="block"
        style={{ cursor: dragging ? 'grabbing' : 'crosshair', touchAction: 'none' }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={endDrag}
        onMouseLeave={() => { endDrag(); setHover(null) }}
        onDoubleClick={() => setView({ s: 0, e: 1 })}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD_LEFT} y={PAD_TOP} width={plotW} height={plotH} />
          </clipPath>
        </defs>

        {/* horizontal gridlines + right OI axis labels */}
        {yTicks.map((t) => {
          const y = yAt(t)
          return (
            <g key={`g${t}`}>
              <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={y} y2={y} stroke="var(--color-slate-100)" strokeWidth={1} />
              <text x={PAD_LEFT + plotW + 6} y={y + 3.5} fontSize={11} fill="var(--color-slate-400)">{fmtY(t)}</text>
            </g>
          )
        })}

        {/* left Future price axis labels */}
        {futTicks.map((t) => (
          <text key={`f${t}`} x={PAD_LEFT - 6} y={yFut(t) + 3.5} fontSize={11} fill="var(--color-slate-400)" textAnchor="end">
            {fmtPriceTick(t, futStep)}
          </text>
        ))}

        {/* zero baseline for signed (OI change) charts */}
        {signed && yMin < 0 && yMax > 0 && (
          <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={yAt(0)} y2={yAt(0)} stroke="var(--color-slate-300)" strokeWidth={1.25} strokeDasharray="2 2" />
        )}

        {/* x-axis time labels + vertical gridlines at round clock times */}
        {xTicks.map((t) => {
          const x = xOfTime(t)
          if (x < PAD_LEFT - 1 || x > PAD_LEFT + plotW + 1) return null
          return (
            <g key={`x${t}`}>
              <line x1={x} x2={x} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke="var(--color-slate-100)" strokeWidth={1} />
              <text
                x={x}
                y={height - 12}
                fontSize={11}
                fill="var(--color-slate-400)"
                textAnchor={x < PAD_LEFT + 24 ? 'start' : x > PAD_LEFT + plotW - 24 ? 'end' : 'middle'}
              >
                {fmtClock(new Date(t).toISOString())}
              </text>
            </g>
          )
        })}

        {/* plotted content (clipped to the plot rect) */}
        <g clipPath={`url(#${clipId})`}>
          {hasFuture && futDomain && futureD && (
            <path d={futureD} fill="none" stroke={FUT} strokeWidth={1.5} strokeDasharray="5 3" opacity={0.9} />
          )}
          {series.map((s, i) => (
            <path key={s.key} d={seriesD[i]} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {hover != null && !dragging && (
            <>
              <line x1={hx} x2={hx} y1={PAD_TOP} y2={PAD_TOP + plotH} stroke="var(--color-slate-300)" strokeWidth={1} strokeDasharray="3 3" />
              {futHover != null && futDomain && <circle cx={hx} cy={yFut(futHover)} r={3.5} fill={FUT} />}
              {series.map((s) =>
                s.values[hover] == null ? null : (
                  <circle key={s.key} cx={hx} cy={yAt(s.values[hover] as number)} r={4} fill={s.color} stroke="var(--color-white)" strokeWidth={1.5} />
                ),
              )}
            </>
          )}
        </g>

        {/* right-edge value badges */}
        {badges.map((b) => (
          <g key={`b${b.key}`}>
            <rect x={PAD_LEFT + plotW + 2} y={b.y - 8} width={PAD_RIGHT - 4} height={16} rx={3} fill={b.color} />
            <text x={PAD_LEFT + plotW + 2 + (PAD_RIGHT - 4) / 2} y={b.y + 3.5} fontSize={10.5} fontWeight={700} fill="#fff" textAnchor="middle">{b.text}</text>
          </g>
        ))}

        {/* latest future price pill on the left axis (persistent, StockMojo-style) */}
        {futLast != null && futDomain && (hover == null || dragging) && (
          <g>
            <rect x={2} y={clamp(yFut(futLast), PAD_TOP + 8, PAD_TOP + plotH - 8) - 8} width={PAD_LEFT - 6} height={16} rx={3} fill="var(--color-slate-500)" />
            <text x={2 + (PAD_LEFT - 6) / 2} y={clamp(yFut(futLast), PAD_TOP + 8, PAD_TOP + plotH - 8) + 3.5} fontSize={9.5} fontWeight={700} fill="var(--color-slate-50)" textAnchor="middle">{PRICE_FMT_2.format(futLast)}</text>
          </g>
        )}

        {/* future value pill on the left axis (hover) */}
        {hover != null && !dragging && futHover != null && futDomain && (
          <g>
            <rect x={2} y={yFut(futHover) - 8} width={PAD_LEFT - 6} height={16} rx={3} fill="var(--color-slate-700)" />
            <text x={2 + (PAD_LEFT - 6) / 2} y={yFut(futHover) + 3.5} fontSize={9.5} fontWeight={700} fill="var(--color-slate-50)" textAnchor="middle">{PRICE_FMT_2.format(futHover)}</text>
          </g>
        )}

        {/* hovered-time pill on the x-axis */}
        {hover != null && !dragging && (
          <g>
            <rect x={clamp(hx - 34, PAD_LEFT, PAD_LEFT + plotW - 68)} y={height - 24} width={68} height={15} rx={3} fill="var(--color-slate-700)" />
            <text x={clamp(hx, PAD_LEFT + 34, PAD_LEFT + plotW - 34)} y={height - 13} fontSize={10} fontWeight={600} fill="var(--color-slate-50)" textAnchor="middle">{fmtClock(times[hover])}</text>
          </g>
        )}
      </svg>

      {/* zoom indicator / reset */}
      {zoomed && (
        <button
          type="button"
          onClick={() => setView({ s: 0, e: 1 })}
          className="press absolute right-2 top-2 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm backdrop-blur hover:bg-slate-50 dark:bg-[#141b27]/90"
        >
          Reset zoom
        </button>
      )}

      {/* tooltip */}
      {hover != null && !dragging && (
        <Tooltip
          xFrac={clamp((xAt(hover) - PAD_LEFT) / plotW, 0, 1)}
          time={times[hover]}
          future={futHover}
          rows={series.map((s) => ({ label: s.label, color: s.color, value: s.values[hover!] ?? null }))}
          fmt={fmtY}
        />
      )}
    </div>
  )
}

function Tooltip({
  xFrac,
  time,
  future,
  rows,
  fmt,
}: {
  xFrac: number
  time: string
  future: number | null
  rows: { label: string; color: string; value: number | null }[]
  fmt: (v: number) => string
}) {
  const left = xFrac > 0.55
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 min-w-[190px] rounded-lg border border-slate-200 bg-white/95 p-2.5 text-xs shadow-lg backdrop-blur dark:bg-[#141b27]/95"
      style={left ? { right: `${(1 - xFrac) * 100}%`, marginRight: 16 } : { left: `${xFrac * 100}%`, marginLeft: 16 }}
    >
      <div className="mb-1.5 font-semibold text-slate-700">{fmtClock(time)}</div>
      {future != null && (
        <div className="mb-1 flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="inline-block h-1.5 w-3 rounded-sm" style={{ background: FUT }} /> Future
          </span>
          <span className="font-bold text-slate-800">{PRICE_FMT_2.format(future)}</span>
        </div>
      )}
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-slate-500">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: r.color }} /> {r.label}
          </span>
          <span className="font-bold text-slate-800">{r.value == null ? '—' : fmt(r.value)}</span>
        </div>
      ))}
    </div>
  )
}
