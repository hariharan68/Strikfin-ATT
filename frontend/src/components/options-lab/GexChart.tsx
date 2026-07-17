import { useCallback, useEffect, useMemo, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import {
  GridComponent,
  MarkAreaComponent,
  MarkLineComponent,
  TooltipComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import EChartsReactCore from 'echarts-for-react/esm/core'
import type EChartsReactCoreType from 'echarts-for-react/esm/core'
import type { BarSeriesOption, EChartsOption, LineSeriesOption } from 'echarts'
import type { StrikeGEX } from '../../lib/gex'
import { toCrore } from '../../lib/gex'
import { useTheme } from '../../lib/useTheme'
import { callPutColors, usePreferences } from '../../lib/usePreferences'

echarts.use([
  BarChart,
  LineChart,
  GridComponent,
  TooltipComponent,
  MarkLineComponent,
  MarkAreaComponent,
  CanvasRenderer,
])

export type GexChartMode = 'net_abs' | 'call_put'

interface Props {
  /** Per-strike GEX in rupees (unscaled) — the chart renders in ₹ Cr. */
  rows: StrikeGEX[]
  mode: GexChartMode
  spot?: number
  atmStrike?: number
  callWall?: number | null
  putWall?: number | null
  /** Zero-gamma spot (total dealer gamma sign flip). */
  gammaFlip?: number | null
  /** Per-strike net GEX profile zero-cross (near the money). */
  netGexCross?: number | null
  showWalls: boolean
  showFlip: boolean
  /** Tooltip header label, e.g. "12:44 PM". */
  snapshotLabel: string
}

const CHART_H = 424
const GROUP_PX = 46
const ABS_COLOR = '#f59e0b'
const FLIP_COLOR = '#06b6d4' // Gamma Flip (zero-gamma spot) — cyan
const NET_CROSS_COLOR = '#f97316' // Net GEX Cross (per-strike net zero-cross) — orange

/** ₹ Crore with L Cr / K Cr steps (input already in Crore). */
export function fmtCr(vCr: number): string {
  const a = Math.abs(vCr)
  if (a >= 1e5) return `${(vCr / 1e5).toFixed(2)} L Cr`
  if (a >= 1e3) return `${(vCr / 1e3).toFixed(1)}K Cr`
  if (a >= 10) return `${vCr.toFixed(0)} Cr`
  return `${vCr.toFixed(2)} Cr`
}

function fmtSignedCr(vCr: number): string {
  const sign = vCr > 0 ? '+' : vCr < 0 ? '−' : ''
  return `${sign}${fmtCr(Math.abs(vCr))}`
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
 * strikes — lets markLines land *between* strikes (spot, gamma flip).
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
 * Per-strike dealer Gamma Exposure on ECharts. Two modes:
 *  - net_abs: net GEX bars (green ≥ 0, red < 0) + an ABS GEX line overlay.
 *  - call_put: call GEX bars up / put GEX bars down + a net GEX line.
 * Overlays: dashed Spot vertical, ATM band, and labelled Call Wall / Put Wall /
 * Gamma Flip markers when toggled. Live polls mutate the existing instance via
 * setOption merge; the chart is never remounted.
 */
export function GexChart({
  rows,
  mode,
  spot,
  atmStrike,
  callWall,
  putWall,
  gammaFlip,
  netGexCross,
  showWalls,
  showFlip,
  snapshotLabel,
}: Props) {
  const chartRef = useRef<EChartsReactCoreType>(null)
  const { isDark } = useTheme()
  const { showChartTooltip, callPutScheme } = usePreferences()

  const rowByStrike = useMemo(() => {
    const m = new Map<number, StrikeGEX>()
    rows.forEach((r) => m.set(r.strike, r))
    return m
  }, [rows])

  const buildOption = useCallback((): EChartsOption => {
    const C = chromeFor(isDark)
    const { call: CALL, put: PUT } = callPutColors(callPutScheme)
    const fontFamily = getComputedStyle(document.body).fontFamily
    const strikes = rows.map((r) => r.strike)
    const cats = strikes.map((s) => String(s))

    // ── Overlays: ATM band + spot / walls / flip verticals ──
    const atmIdx = atmStrike !== undefined ? strikes.indexOf(atmStrike) : -1
    const markArea =
      atmIdx >= 0
        ? {
            silent: true,
            itemStyle: { color: C.atmCol },
            data: [[{ xAxis: cats[atmIdx] }, { xAxis: cats[atmIdx] }]] as never,
          }
        : undefined

    const pill = (text: string, bg: string, position: 'start' | 'end') => ({
      show: true,
      position,
      formatter: text,
      color: '#fff',
      backgroundColor: bg,
      padding: [3, 6] as [number, number],
      borderRadius: 4,
      fontSize: 10,
      fontWeight: 600 as const,
    })

    const markLineData: Record<string, unknown>[] = []
    const spotIdx = priceIndex(spot, strikes)
    if (spotIdx !== null && spot !== undefined) {
      markLineData.push({
        xAxis: spotIdx,
        lineStyle: { color: C.axisText, width: 1.25, type: [2, 3] },
        label: pill(`Spot: ${Math.round(spot)}`, '#1e293b', 'end'),
      })
    }
    if (showWalls) {
      const cwIdx = priceIndex(callWall, strikes)
      if (cwIdx !== null && callWall != null) {
        markLineData.push({
          xAxis: cwIdx,
          lineStyle: { color: CALL, width: 1.25, type: [5, 3] },
          label: pill(`Call Wall: ${callWall}`, CALL, 'start'),
        })
      }
      const pwIdx = priceIndex(putWall, strikes)
      if (pwIdx !== null && putWall != null) {
        markLineData.push({
          xAxis: pwIdx,
          lineStyle: { color: PUT, width: 1.25, type: [5, 3] },
          label: pill(`Put Wall: ${putWall}`, PUT, 'start'),
        })
      }
    }
    if (showFlip) {
      const ncIdx = priceIndex(netGexCross, strikes)
      if (ncIdx !== null && netGexCross != null) {
        markLineData.push({
          xAxis: ncIdx,
          lineStyle: { color: NET_CROSS_COLOR, width: 1.25, type: [4, 3] },
          label: pill(`Net GEX Cross: ${Math.round(netGexCross)}`, NET_CROSS_COLOR, 'start'),
        })
      }
      const gfIdx = priceIndex(gammaFlip, strikes)
      if (gfIdx !== null && gammaFlip != null) {
        markLineData.push({
          xAxis: gfIdx,
          lineStyle: { color: FLIP_COLOR, width: 1.5, type: [4, 3] },
          label: pill(`Gamma Flip: ${Math.round(gammaFlip)}`, FLIP_COLOR, 'end'),
        })
      }
    }

    const barCommon: Partial<BarSeriesOption> = {
      type: 'bar',
      barMaxWidth: 26,
      barGap: '-100%', // call/put bars share the slot (one is +, the other −)
      emphasis: { focus: 'none' },
    }
    const lineCommon: Partial<LineSeriesOption> = {
      type: 'line',
      symbol: 'circle',
      symbolSize: 5,
      showSymbol: rows.length <= 30,
      smooth: 0.25,
      z: 5,
      emphasis: { focus: 'none' },
    }

    const series: (BarSeriesOption | LineSeriesOption)[] =
      mode === 'net_abs'
        ? [
            {
              ...barCommon,
              id: 'net',
              name: 'Net GEX',
              data: rows.map((r) => {
                const v = toCrore(r.netGEX)
                const color = v >= 0 ? CALL : PUT
                return {
                  value: v,
                  itemStyle: {
                    color,
                    borderRadius: (v >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3]) as [number, number, number, number],
                  },
                }
              }),
            } as BarSeriesOption,
            {
              ...lineCommon,
              id: 'abs',
              name: 'ABS GEX',
              lineStyle: { color: ABS_COLOR, width: 2 },
              itemStyle: { color: ABS_COLOR },
              data: rows.map((r) => toCrore(r.absGEX)),
            } as LineSeriesOption,
          ]
        : [
            {
              ...barCommon,
              id: 'call',
              name: 'Call GEX',
              data: rows.map((r) => ({
                value: toCrore(r.callGEX),
                itemStyle: { color: CALL, borderRadius: [3, 3, 0, 0] as [number, number, number, number] },
              })),
            } as BarSeriesOption,
            {
              ...barCommon,
              id: 'put',
              name: 'Put GEX',
              data: rows.map((r) => ({
                value: toCrore(r.putGEX),
                itemStyle: { color: PUT, borderRadius: [0, 0, 3, 3] as [number, number, number, number] },
              })),
            } as BarSeriesOption,
            {
              ...lineCommon,
              id: 'net-line',
              name: 'Net GEX',
              lineStyle: { color: ABS_COLOR, width: 2 },
              itemStyle: { color: ABS_COLOR },
              data: rows.map((r) => toCrore(r.netGEX)),
            } as LineSeriesOption,
          ]

    // Attach the overlays to the first series so they render once.
    if (series[0]) {
      if (markArea) (series[0] as BarSeriesOption).markArea = markArea as never
      if (markLineData.length) {
        ;(series[0] as BarSeriesOption).markLine = {
          silent: true,
          symbol: 'none',
          data: markLineData as never,
        }
      }
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
          const r = rowByStrike.get(strike)
          if (!r) return ''
          const atm = strike === atmStrike
          const chip = (color: string) =>
            `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:6px"></span>`
          const line = (label: string, color: string, v: number, bold = false) =>
            `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
            `<span>${chip(color)}${label}</span>` +
            `<span style="font-weight:700;${bold ? '' : `color:${C.tipText}`}">${fmtSignedCr(toCrore(v))}</span></div>`
          const netColor = r.netGEX >= 0 ? '#34d399' : '#fb7185'
          return (
            `<div style="padding:9px 11px;color:${C.tipText};font-size:12px;min-width:220px">` +
            `<div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:2px">` +
            `<span>Strike: ${strike}</span>${atm ? '<span style="color:#fbbf24;font-size:10px;font-weight:700">ATM</span>' : ''}</div>` +
            (spot !== undefined
              ? `<div style="font-size:11px;color:${C.axisText};margin-bottom:6px">Spot ${spot.toFixed(1)} · ${snapshotLabel}</div>`
              : '') +
            line('Call GEX', CALL, r.callGEX) +
            line('Put GEX', PUT, r.putGEX) +
            `<div style="height:1px;background:${C.tipBorder};margin:6px 0"></div>` +
            `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
            `<span>Net GEX</span><span style="font-weight:700;color:${netColor}">${fmtSignedCr(toCrore(r.netGEX))}</span></div>` +
            `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
            `<span>ABS GEX</span><span style="font-weight:700">${fmtCr(toCrore(r.absGEX))}</span></div>` +
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
          interval: rows.length > 26 ? 1 : 0,
        } as never,
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: C.grid } },
        axisLabel: {
          color: C.axisText,
          fontSize: 10,
          formatter: (v: number) => (v === 0 ? '0' : fmtCr(v)),
        },
      },
      series,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, mode, spot, atmStrike, callWall, putWall, gammaFlip, netGexCross, showWalls, showFlip, snapshotLabel, isDark, rowByStrike, callPutScheme, showChartTooltip])

  const initialOption = useMemo(() => buildOption(), [])
  // Live polls / mode / toggle / theme changes mutate the existing instance;
  // replaceMerge on `series` drops stale series when the mode switches.
  useEffect(() => {
    const inst = chartRef.current?.getEchartsInstance()
    if (!inst) return
    inst.setOption(buildOption(), { replaceMerge: ['series'] })
  }, [buildOption])

  const C = chromeFor(isDark)
  const { call: CALL, put: PUT } = callPutColors(callPutScheme)
  const minWidth = Math.max(560, rows.length * GROUP_PX)

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
        {mode === 'net_abs' ? (
          <>
            <LegendItem color={CALL} kind="solid" label="Net GEX > 0 (long gamma)" />
            <LegendItem color={PUT} kind="solid" label="Net GEX < 0 (short gamma)" />
            <LegendItem color={ABS_COLOR} kind="line" label="ABS GEX" />
          </>
        ) : (
          <>
            <LegendItem color={CALL} kind="solid" label="Call GEX" />
            <LegendItem color={PUT} kind="solid" label="Put GEX" />
            <LegendItem color={ABS_COLOR} kind="line" label="Net GEX" />
          </>
        )}
        {showFlip && <LegendItem color={NET_CROSS_COLOR} kind="line" label="Net GEX Cross" />}
        {showFlip && <LegendItem color={FLIP_COLOR} kind="line" label="Gamma Flip" />}
      </div>
    </div>
  )
}

function LegendItem({ color, kind, label }: { color: string; kind: 'solid' | 'line'; label: string }) {
  const style: React.CSSProperties =
    kind === 'solid'
      ? { background: color, height: 12, width: 12 }
      : { background: color, height: 3, width: 14, borderRadius: 2 }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block rounded-sm" style={style} />
      {label}
    </span>
  )
}
