import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import {
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import EChartsReactCore from 'echarts-for-react/esm/core'
import type EChartsReactCoreType from 'echarts-for-react/esm/core'
import type { BarSeriesOption, EChartsOption } from 'echarts'
import type { PainPoint } from '../../lib/maxpain'
import { useTheme } from '../../lib/useTheme'
import { callPutColors, usePreferences } from '../../lib/usePreferences'

echarts.use([
  BarChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
])

interface Props {
  /** Per-strike pain curve (full or trimmed window). */
  bars: PainPoint[]
  spot?: number
  atmStrike?: number
  maxPain?: number | null
}

const CHART_H = 424
const GROUP_PX = 46

/** Compact ₹ magnitude for pain values (OI × index-points). */
export function fmtPain(v: number): string {
  const a = Math.abs(v)
  if (a >= 1e12) return `${(v / 1e12).toFixed(2)} L Cr`
  if (a >= 1e7) return `${(v / 1e7).toFixed(2)} Cr`
  if (a >= 1e5) return `${(v / 1e5).toFixed(2)} L`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`
  return String(Math.round(v))
}

/** Canvas + axis colours follow the app theme (mirrors OpenInterestChart). */
function chromeFor(isDark: boolean) {
  return isDark
    ? {
        canvas: '#0b0f17',
        grid: 'rgba(148,163,184,0.13)',
        baseline: 'rgba(148,163,184,0.38)',
        axisText: '#94a3b8',
        strikeText: '#cbd5e1',
        atmText: '#fbbf24',
        atmCol: 'rgba(251,191,36,0.10)',
        hoverCol: 'rgba(255,255,255,0.06)',
        tipBg: 'rgba(15,23,42,0.96)',
        tipBorder: 'rgba(148,163,184,0.28)',
        tipText: '#e2e8f0',
        legend: 'text-slate-300',
      }
    : {
        canvas: '#ffffff',
        grid: 'rgba(100,116,139,0.16)',
        baseline: 'rgba(100,116,139,0.35)',
        axisText: '#64748b',
        strikeText: '#475569',
        atmText: '#b45309',
        atmCol: 'rgba(245,158,11,0.10)',
        hoverCol: 'rgba(15,23,42,0.06)',
        tipBg: 'rgba(255,255,255,0.97)',
        tipBorder: 'rgba(100,116,139,0.22)',
        tipText: '#334155',
        legend: 'text-slate-600',
      }
}

/**
 * Fractional category index for a price, interpolated between the surrounding
 * strikes — lets Spot / Max Pain markLines land *between* strikes.
 */
function priceIndex(price: number | null | undefined, strikes: number[]): number | null {
  const n = strikes.length
  if (price == null || n === 0) return null
  if (price <= strikes[0]) return 0
  if (price >= strikes[n - 1]) return n - 1
  for (let i = 0; i < n - 1; i++) {
    if (price >= strikes[i] && price <= strikes[i + 1]) {
      const f = (price - strikes[i]) / (strikes[i + 1] - strikes[i] || 1)
      return i + f
    }
  }
  return null
}

/**
 * Max Pain on ECharts: one bar per strike = total pain at that settlement
 * (call pain + put pain), coloured green where call pain dominates (above the
 * pin) / red where put pain dominates (below). The curve is a "V" with its
 * minimum at the Max Pain strike. Overlays: amber Max Pain vertical, dark Spot
 * vertical, ATM column band. Live polls mutate the existing instance via
 * setOption merge; the chart is never remounted.
 */
export function MaxPainChart({ bars, spot, atmStrike, maxPain }: Props) {
  const chartRef = useRef<EChartsReactCoreType>(null)
  const { isDark } = useTheme()
  const { showChartTooltip, callPutScheme } = usePreferences()

  const byStrike = useMemo(() => {
    const m = new Map<number, PainPoint>()
    bars.forEach((b) => m.set(b.strike, b))
    return m
  }, [bars])

  const buildOption = useCallback((): EChartsOption => {
    const C = chromeFor(isDark)
    const { call: CALL, put: PUT } = callPutColors(callPutScheme)
    const fontFamily = getComputedStyle(document.body).fontFamily
    const strikes = bars.map((b) => b.strike)
    const cats = strikes.map((s) => String(s))

    // ── Overlays: ATM band + Max Pain / Spot verticals ──
    const atmIdx = atmStrike !== undefined ? strikes.indexOf(atmStrike) : -1
    const markArea =
      atmIdx >= 0
        ? {
            silent: true,
            itemStyle: { color: C.atmCol },
            data: [[{ xAxis: cats[atmIdx] }, { xAxis: cats[atmIdx] }]] as never,
          }
        : undefined

    const markLineData: Record<string, unknown>[] = []
    const mpIdx = priceIndex(maxPain, strikes)
    if (mpIdx !== null && maxPain != null) {
      markLineData.push({
        xAxis: mpIdx,
        lineStyle: { color: '#f59e0b', width: 1.25, type: [5, 3] },
        label: {
          show: true,
          position: 'start',
          formatter: `Max Pain: ${Math.round(maxPain)}`,
          color: '#fff',
          backgroundColor: '#b45309',
          padding: [3, 6],
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
        },
      })
    }
    const spotIdx = priceIndex(spot, strikes)
    if (spotIdx !== null && spot !== undefined) {
      markLineData.push({
        xAxis: spotIdx,
        lineStyle: { color: C.axisText, width: 1.25, type: [2, 3] },
        label: {
          show: true,
          position: 'end',
          formatter: `Spot: ${Math.round(spot)}`,
          color: '#fff',
          backgroundColor: '#1e293b',
          padding: [3, 6],
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
        },
      })
    }

    const series: BarSeriesOption[] = [
      {
        type: 'bar',
        id: 'pain',
        name: 'Pain',
        barMaxWidth: 26,
        emphasis: { focus: 'none' },
        data: bars.map((b) => ({
          value: b.totalPain,
          // Green where call pain dominates (above the pin), red below.
          itemStyle: {
            color: b.callPain >= b.putPain ? CALL : PUT,
            borderRadius: [3, 3, 0, 0] as [number, number, number, number],
          },
        })),
      },
    ]
    if (markArea) series[0].markArea = markArea as never
    if (markLineData.length) {
      series[0].markLine = { silent: true, symbol: 'none', data: markLineData as never }
    }

    return {
      backgroundColor: C.canvas,
      animationDuration: 300,
      animationDurationUpdate: 300,
      textStyle: { fontFamily },
      grid: { left: 8, right: 18, top: 38, bottom: 30, containLabel: true },
      tooltip: {
        show: showChartTooltip,
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: C.hoverCol } },
        backgroundColor: C.tipBg,
        borderColor: C.tipBorder,
        borderWidth: 1,
        padding: 0,
        extraCssText: 'box-shadow: 0 10px 30px rgba(0,0,0,0.22); border-radius: 10px;',
        formatter: (params) => {
          const list = (Array.isArray(params) ? params : [params]) as { axisValue?: string | number }[]
          const strike = Number(list[0]?.axisValue)
          const b = byStrike.get(strike)
          if (!b) return ''
          const atm = strike === atmStrike
          const isMp = maxPain != null && strike === Math.round(maxPain)
          const chip = (color: string) =>
            `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:6px"></span>`
          const row = (label: string, color: string, v: number, bold = false) =>
            `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
            `<span>${color ? chip(color) : ''}${label}</span>` +
            `<span style="font-weight:700${bold ? '' : `;color:${C.tipText}`}">${fmtPain(v)}</span></div>`
          const badge = isMp
            ? '<span style="color:#f59e0b;font-size:10px;font-weight:700">MAX PAIN</span>'
            : atm
              ? '<span style="color:#fbbf24;font-size:10px;font-weight:700">ATM</span>'
              : ''
          return (
            `<div style="padding:9px 11px;color:${C.tipText};font-size:12px;min-width:220px">` +
            `<div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:4px">` +
            `<span>Strike: ${strike}</span>${badge}</div>` +
            row('Call Pain', CALL, b.callPain) +
            row('Put Pain', PUT, b.putPain) +
            `<div style="height:1px;background:${C.tipBorder};margin:6px 0"></div>` +
            `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
            `<span>Total Pain</span><span style="font-weight:700">${fmtPain(b.totalPain)}</span></div>` +
            `</div>`
          )
        },
      },
      xAxis: {
        type: 'category',
        data: cats,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: C.baseline } },
        axisLabel: {
          color: (v: string) => (Number(v) === atmStrike ? C.atmText : C.strikeText),
          fontWeight: (v: string) => (Number(v) === atmStrike ? 'bold' : 'normal'),
          fontSize: 10,
          interval: bars.length > 26 ? 1 : 0,
        } as never,
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: {
          color: C.axisText,
          fontSize: 10,
          formatter: (v: number) => (v === 0 ? '0' : fmtPain(v)),
        },
      },
      series,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, spot, atmStrike, maxPain, isDark, byStrike, callPutScheme, showChartTooltip])

  const initialOption = useMemo(() => buildOption(), [])
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    inst.setOption(buildOption(), { replaceMerge: ['series'] })
  }, [buildOption])

  const C = chromeFor(isDark)
  const { call: CALL, put: PUT } = callPutColors(callPutScheme)
  const minWidth = Math.max(560, bars.length * GROUP_PX)

  return (
    <div className="overflow-x-auto rounded-2xl" style={{ background: C.canvas }}>
      <div style={{ minWidth }}>
        <EChartsReactCore
          ref={chartRef}
          echarts={echarts}
          option={initialOption}
          notMerge
          lazyUpdate
          shouldSetOption={() => false}
          style={{ height: CHART_H, width: '100%' }}
        />
      </div>
      {/* Legend */}
      <div className={`flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 px-3 pb-3 pt-1 text-[11px] ${C.legend}`}>
        <LegendItem color={CALL} label="Call Pain" />
        <LegendItem color={PUT} label="Put Pain" />
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}
