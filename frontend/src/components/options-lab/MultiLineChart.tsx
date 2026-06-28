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

const PRICE_FMT = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 })

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
export function MultiLineChart({ times, series, future, lotSize, showLot, signed, height = 360 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const W = useWidth(wrapRef)
  const clipId = useId()

  const [hover, setHover] = useState<number | null>(null)
  // Visible window as [start, end] fractions in [0, 1]. {0,1} = whole session.
  const [view, setView] = useState({ s: 0, e: 1 })
  const drag = useRef<{ px: number; s: number; e: number } | null>(null)

  const hasFuture = !!future && future.some((v) => v != null)
  const PAD_LEFT = hasFuture ? 52 : 12
  const PAD_RIGHT = 66

  const plotW = Math.max(10, W - PAD_LEFT - PAD_RIGHT)
  const plotH = height - PAD_TOP - PAD_BOTTOM
  const n = times.length

  const spanF = Math.max(MIN_SPAN, view.e - view.s)
  const fOf = (i: number) => (n > 1 ? i / (n - 1) : 0)
  const xAt = (i: number) => PAD_LEFT + ((fOf(i) - view.s) / spanF) * plotW
  const xToFrac = (px: number) => view.s + ((px - PAD_LEFT) / plotW) * spanF

  // Indices currently visible (with a one-point margin for line continuity).
  const [iStart, iEnd] = useMemo(() => {
    if (n <= 1) return [0, n - 1] as const
    const a = clamp(Math.floor(view.s * (n - 1)), 0, n - 1)
    const b = clamp(Math.ceil(view.e * (n - 1)), 0, n - 1)
    return [a, b] as const
  }, [view, n])

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
    [series, view, W, height, yMin, yMax, iStart, iEnd, hasFuture],
  )
  const futureD = useMemo(
    () => (hasFuture && futDomain ? linePath(future!, yFut) : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [future, hasFuture, futDomain, view, W, height, iStart, iEnd],
  )

  const yTicks = useMemo(() => niceTicks(yMin, yMax, 5), [yMin, yMax])
  const futTicks = useMemo(() => (futDomain ? niceTicks(futDomain.lo, futDomain.hi, 5) : []), [futDomain])

  // x-axis time labels across the visible window (about 7).
  const xLabelIdx = useMemo(() => {
    if (n <= 1) return [0]
    const want = Math.min(7, iEnd - iStart + 1)
    if (want <= 1) return [iStart]
    const set = new Set<number>()
    for (let k = 0; k < want; k++) set.add(iStart + Math.round((k / (want - 1)) * (iEnd - iStart)))
    return [...set].sort((a, b) => a - b)
  }, [n, iStart, iEnd])

  // ── right-edge value badges (value at the right edge of the window) ──
  const badges = useMemo(() => {
    const lastV = clamp(Math.round(view.e * (n - 1)), 0, n - 1)
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
  }, [series, yMin, yMax, plotH, showLot, lotSize, signed, view, n])

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
    const frac = (px - PAD_LEFT) / plotW
    const fi = view.s + frac * spanF
    setHover(clamp(Math.round(fi * (n - 1)), 0, n - 1))
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
            {PRICE_FMT.format(t)}
          </text>
        ))}

        {/* zero baseline for signed (OI change) charts */}
        {signed && yMin < 0 && yMax > 0 && (
          <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={yAt(0)} y2={yAt(0)} stroke="var(--color-slate-300)" strokeWidth={1.25} strokeDasharray="2 2" />
        )}

        {/* x-axis time labels (ends anchored so they don't clip) */}
        {xLabelIdx.map((i, k) => (
          <text
            key={`x${i}`}
            x={clamp(xAt(i), PAD_LEFT, PAD_LEFT + plotW)}
            y={height - 12}
            fontSize={11}
            fill="var(--color-slate-400)"
            textAnchor={k === 0 ? 'start' : k === xLabelIdx.length - 1 ? 'end' : 'middle'}
          >
            {fmtClock(times[i])}
          </text>
        ))}

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

        {/* future value pill on the left axis (hover) */}
        {hover != null && !dragging && futHover != null && futDomain && (
          <g>
            <rect x={2} y={yFut(futHover) - 8} width={PAD_LEFT - 6} height={16} rx={3} fill="var(--color-slate-700)" />
            <text x={2 + (PAD_LEFT - 6) / 2} y={yFut(futHover) + 3.5} fontSize={10} fontWeight={700} fill="var(--color-slate-50)" textAnchor="middle">{PRICE_FMT.format(futHover)}</text>
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
          <span className="font-bold text-slate-800">{future.toFixed(1)}</span>
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
