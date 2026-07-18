import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
// The esm build — the lib/ (CJS) entry resolves to a module object under
// Vite's dev-server interop and crashes React ("Element type is invalid").
import EChartsReactCore from 'echarts-for-react/esm/core'
import type EChartsReactCoreType from 'echarts-for-react/esm/core'
import type { EChartsOption, SeriesOption } from 'echarts'
import { useTheme } from '../../lib/useTheme'
import { usePreferences } from '../../lib/usePreferences'
import { fmtOI } from './OpenInterestChart'

echarts.use([
  LineChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  DataZoomComponent,
  CanvasRenderer,
])

// ── Types (unchanged public contract) ──────────────────────────────
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
  /**
   * Override the right-axis value formatting (axis labels, cross-pointer, series
   * end-pills, tooltip body). Defaults to the OI formatter (`fmtOI` + signed).
   * The PCR chart passes a plain-ratio formatter so its right axis shows e.g.
   * "1.25" instead of OI units. The Future (left) axis always stays price-formatted.
   */
  valueFmt?: (v: number) => string
  /** Initial visibility of the future overlay (toggleable via the legend). */
  showFuture?: boolean
  /**
   * Fixed x-axis domain (ISO timestamps), e.g. 09:15 → 15:30 IST of the trade
   * date. When set, the axis always covers the full session and the intraday
   * curve builds left-to-right as snapshots accrue.
   */
  domainStart?: string
  domainEnd?: string
  height?: number
}

const FUTURE_ID = '__future__'
const FUTURE_NAME = 'Future'
const FUT_COLOR = '#94a3b8' // slate-400 — readable in every theme
// Smallest zoom window: ~15 min of a 6h15m session (mirrors the old MIN_SPAN).
const MIN_ZOOM_SPAN_MS = 15 * 60_000

const CLOCK_FMT = new Intl.DateTimeFormat('en-IN', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  timeZone: 'Asia/Kolkata',
})
const PRICE_FMT_2 = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

function fmtClock(ts: number): string {
  return Number.isFinite(ts) ? CLOCK_FMT.format(new Date(ts)) : ''
}

/**
 * Resolve the app's themed CSS variables (remapped per theme on <html>) into
 * concrete colors ECharts' canvas renderer can use.
 */
function resolveThemeColors() {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback
  return {
    cardBg: v('--color-slate-50', '#ffffff'),
    grid: v('--color-slate-100', '#f1f5f9'),
    axisLine: v('--color-slate-200', '#e2e8f0'),
    axisLabel: v('--color-slate-400', '#94a3b8'),
    zeroLine: v('--color-slate-300', '#cbd5e1'),
    legendText: v('--color-slate-600', '#475569'),
    legendInactive: v('--color-slate-300', '#cbd5e1'),
    tooltipText: v('--color-slate-700', '#334155'),
    pointerLabelBg: v('--color-slate-700', '#334155'),
    pointerLabelText: v('--color-slate-50', '#f8fafc'),
  }
}

/** [timestamp, value] pairs for a time axis; null values render as gaps. */
function toPairs(tms: number[], values: (number | null)[]): [number, number | null][] {
  return tms.map((t, i) => [t, values[i] ?? null])
}

/**
 * Multi-line intraday chart on Apache ECharts with a dual axis (Future price
 * left, OI/Volume right), shared crosshair tooltip, click-to-toggle legend,
 * right-edge value pills, and pan/zoom (wheel + drag + slider; double-click
 * or the overlay button resets). Live polls update the existing chart
 * instance via setOption merge — the instance is never remounted.
 */
export function MultiLineChart({
  times,
  series,
  future,
  lotSize,
  showLot,
  signed,
  valueFmt,
  showFuture = true,
  domainStart,
  domainEnd,
  height = 360,
}: Props) {
  const chartRef = useRef<EChartsReactCoreType>(null)
  const { theme } = useTheme()
  const { showChartTooltip } = usePreferences()
  const [zoomed, setZoomed] = useState(false)

  const n = times.length
  const tms = useMemo(() => times.map((t) => new Date(t).getTime()), [times])
  const t0 = useMemo(() => {
    const d = domainStart ? new Date(domainStart).getTime() : NaN
    return Number.isFinite(d) ? d : (tms[0] ?? 0)
  }, [domainStart, tms])
  const t1 = useMemo(() => {
    const d = domainEnd ? new Date(domainEnd).getTime() : NaN
    return Number.isFinite(d) ? d : (tms[n - 1] ?? 1)
  }, [domainEnd, tms, n])

  const futAvail = !!future && future.some((v) => v != null)
  const fmtY = useCallback(
    (v: number) =>
      valueFmt ? valueFmt(v) : (signed && v > 0 ? '+' : '') + fmtOI(v, showLot, lotSize),
    [signed, showLot, lotSize, valueFmt],
  )

  const buildOption = useCallback((): EChartsOption => {
    const c = resolveThemeColors()
    const fontFamily = getComputedStyle(document.body).fontFamily

    const endLabelBase = {
      show: true,
      color: '#fff',
      fontSize: 10,
      fontWeight: 700 as const,
      padding: [2, 5] as [number, number],
      borderRadius: 3,
      distance: 6,
    }

    const dataSeries: SeriesOption[] = series.map((s) => ({
      id: s.key,
      name: s.label,
      type: 'line',
      yAxisIndex: 1,
      data: toPairs(tms, s.values),
      smooth: 0.25,
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 2, color: s.color },
      itemStyle: { color: s.color },
      emphasis: { lineStyle: { width: 2.5 } },
      endLabel: {
        ...endLabelBase,
        backgroundColor: s.color,
        formatter: (p) => {
          const v = (p.value as [number, number | null])[1]
          return v == null ? '' : fmtY(v)
        },
      },
      labelLayout: { moveOverlap: 'shiftY' },
      z: 3,
    }))

    if (futAvail) {
      dataSeries.push({
        id: FUTURE_ID,
        name: FUTURE_NAME,
        type: 'line',
        yAxisIndex: 0,
        data: toPairs(tms, future!),
        smooth: 0.25,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { width: 1.5, color: FUT_COLOR, type: [5, 3] },
        itemStyle: { color: FUT_COLOR },
        endLabel: {
          ...endLabelBase,
          backgroundColor: c.pointerLabelBg,
          color: c.pointerLabelText,
          formatter: (p) => {
            const v = (p.value as [number, number | null])[1]
            return v == null ? '' : PRICE_FMT_2.format(v)
          },
        },
        labelLayout: { moveOverlap: 'shiftY' },
        z: 2,
      })
    }

    return {
      animation: true,
      animationDuration: 300,
      animationDurationUpdate: 300,
      backgroundColor: 'transparent',
      textStyle: { fontFamily },
      grid: {
        left: futAvail ? 64 : 16,
        right: 84,
        top: 34,
        bottom: 62,
      },
      legend: {
        show: true,
        type: 'scroll',
        top: 0,
        left: 0,
        icon: 'circle',
        itemWidth: 9,
        itemHeight: 9,
        itemGap: 14,
        textStyle: { color: c.legendText, fontSize: 11, fontWeight: 600 },
        inactiveColor: c.legendInactive,
        pageIconColor: c.legendText,
        pageIconInactiveColor: c.legendInactive,
        pageTextStyle: { color: c.axisLabel },
      },
      tooltip: {
        show: showChartTooltip,
        trigger: 'axis',
        transitionDuration: 0.12,
        backgroundColor: c.cardBg,
        borderColor: c.axisLine,
        borderWidth: 1,
        padding: [8, 10],
        textStyle: { color: c.tooltipText, fontSize: 12, fontFamily },
        extraCssText: 'box-shadow: 0 8px 24px rgba(0,0,0,0.12); border-radius: 8px;',
        axisPointer: {
          type: 'cross',
          lineStyle: { color: c.zeroLine, type: [3, 3] },
          crossStyle: { color: c.zeroLine, type: [3, 3] },
          label: {
            backgroundColor: c.pointerLabelBg,
            color: c.pointerLabelText,
            fontSize: 10,
            fontWeight: 600,
            padding: [3, 6],
            borderRadius: 3,
            formatter: (p) => {
              if (p.axisDimension === 'x') return fmtClock(Number(p.value))
              // y axes: 0 = price, 1 = OI/volume
              return p.axisIndex === 0
                ? PRICE_FMT_2.format(Number(p.value))
                : fmtY(Number(p.value))
            },
          },
        },
        formatter: (params) => {
          const list = Array.isArray(params) ? params : [params]
          if (list.length === 0) return ''
          const ts = (list[0].value as [number, number | null])[0]
          const row = (marker: string, label: string, value: string) =>
            `<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;line-height:1.7">` +
            `<span style="display:flex;align-items:center;gap:6px">${marker}${label}</span>` +
            `<span style="font-weight:700">${value}</span></div>`
          // Future first, then contract lines — mirrors the axis layout.
          const sorted = [...list].sort(
            (a, b) => (a.seriesId === FUTURE_ID ? -1 : 0) - (b.seriesId === FUTURE_ID ? -1 : 0),
          )
          const body = sorted
            .map((p) => {
              const v = (p.value as [number, number | null])[1]
              const text =
                v == null ? '—' : p.seriesId === FUTURE_ID ? PRICE_FMT_2.format(v) : fmtY(v)
              return row(String(p.marker ?? ''), String(p.seriesName ?? ''), text)
            })
            .join('')
          return `<div style="font-weight:600;margin-bottom:4px">${fmtClock(ts)}</div>${body}`
        },
      },
      xAxis: {
        type: 'time',
        min: t0,
        max: t1,
        axisLine: { lineStyle: { color: c.axisLine } },
        axisTick: { show: false },
        axisLabel: {
          color: c.axisLabel,
          fontSize: 11,
          hideOverlap: true,
          formatter: (v: number) => fmtClock(v),
        },
        splitLine: { show: true, lineStyle: { color: c.grid } },
      },
      yAxis: [
        {
          // Future price — left
          type: 'value',
          show: futAvail,
          position: 'left',
          scale: true,
          axisLabel: { color: c.axisLabel, fontSize: 11 },
          splitLine: { show: false },
        },
        {
          // OI / Volume — right
          type: 'value',
          position: 'right',
          scale: !signed,
          // signed (OI change) keeps the 0 baseline in view.
          min: signed ? (v: { min: number }) => Math.min(0, v.min) : undefined,
          max: signed ? (v: { max: number }) => Math.max(0, v.max) : undefined,
          axisLabel: {
            color: c.axisLabel,
            fontSize: 11,
            formatter: (v: number) => fmtY(v),
          },
          splitLine: { show: true, lineStyle: { color: c.grid } },
        },
      ],
      dataZoom: [
        {
          type: 'inside',
          xAxisIndex: 0,
          filterMode: 'filter',
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
          throttle: 50,
          minValueSpan: MIN_ZOOM_SPAN_MS,
        },
        {
          type: 'slider',
          xAxisIndex: 0,
          filterMode: 'filter',
          height: 20,
          bottom: 8,
          brushSelect: false,
          borderColor: c.axisLine,
          backgroundColor: 'transparent',
          fillerColor: 'rgba(148, 163, 184, 0.15)',
          dataBackground: {
            lineStyle: { color: c.zeroLine },
            areaStyle: { color: c.grid },
          },
          selectedDataBackground: {
            lineStyle: { color: c.axisLabel },
            areaStyle: { color: c.grid },
          },
          handleStyle: { color: c.axisLabel, borderColor: c.axisLine },
          moveHandleStyle: { color: c.zeroLine },
          emphasis: {
            handleStyle: { color: c.legendText },
            moveHandleStyle: { color: c.axisLabel },
          },
          textStyle: { color: c.axisLabel, fontSize: 10 },
          labelFormatter: (v: number) => fmtClock(v),
          minValueSpan: MIN_ZOOM_SPAN_MS,
        },
      ],
      series: dataSeries,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, future, futAvail, tms, t0, t1, signed, fmtY, theme, showChartTooltip])

  // Initial option — includes the legend's initial Future visibility. Later
  // legend clicks are user state; updates never overwrite them (the merged
  // options below omit legend.selected).
  const initialOption = useMemo(() => {
    const opt = buildOption()
    if (futAvail && !showFuture) {
      opt.legend = { ...(opt.legend as object), selected: { [FUTURE_NAME]: false } }
    }
    return opt
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Live updates + theme/selection changes: mutate the existing instance.
  // replaceMerge on `series` drops deselected contracts instead of leaving
  // stale lines behind; everything else (dataZoom window, legend selection)
  // is preserved. The chart instance itself is never torn down.
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    inst.setOption(buildOption(), { replaceMerge: ['series'] })
  }, [buildOption])

  const resetZoom = useCallback(() => {
    const inst = chartRef.current?.getEchartsInstance()
    inst?.dispatchAction({ type: 'dataZoom', start: 0, end: 100 })
  }, [])

  // Double-click anywhere on the canvas resets the zoom window.
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    const zr = inst.getZr()
    zr.on('dblclick', resetZoom)
    return () => {
      // The zr instance is disposed with the chart on unmount; guard anyway.
      if (!inst.isDisposed()) zr.off('dblclick', resetZoom)
    }
  }, [resetZoom])

  const onEvents = useMemo(
    () => ({
      datazoom: () => {
        const inst = chartRef.current?.getEchartsInstance()
        if (!inst) return
        const dz = (inst.getOption() as { dataZoom?: { start?: number; end?: number }[] })
          .dataZoom?.[0]
        setZoomed(dz != null && ((dz.start ?? 0) > 0.1 || (dz.end ?? 100) < 99.9))
      },
    }),
    [],
  )

  if (n === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-slate-400" style={{ height }}>
        No intraday history yet.
      </div>
    )
  }

  return (
    <div className="relative w-full">
      <EChartsReactCore
        ref={chartRef}
        echarts={echarts}
        option={initialOption}
        notMerge
        lazyUpdate
        // All updates flow through the setOption effect above.
        shouldSetOption={() => false}
        onEvents={onEvents}
        style={{ height, width: '100%' }}
      />
      {zoomed && (
        <button
          type="button"
          onClick={resetZoom}
          className="press absolute right-2 top-7 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm backdrop-blur hover:bg-slate-50 dark:bg-[#141b27]/90"
        >
          Reset zoom
        </button>
      )}
    </div>
  )
}
