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
import { formatInt } from '../../lib/format'
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

// ── Types (unchanged public contract) ──────────────────────────────
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

// Bar colours (Call vs Put) come from the user's call/put scheme preference —
// see `callPutColors` in lib/usePreferences (classic: Call=green/Put=red).
const CHART_H = 424
// Per-strike group width — the chart scrolls horizontally past this many strikes.
const GROUP_PX = 58

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

/** Hex → rgba string at the given alpha. */
function alpha(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** 45° line hatch for the "OI added" segment. */
function hatchDecal(color: string) {
  return {
    color: alpha(color, 0.9),
    dashArrayX: [1, 0],
    dashArrayY: [3, 4],
    rotation: -Math.PI / 4,
    symbolSize: 0.9,
  }
}

/** Canvas + axis colours follow the app theme; bars stay green/red. */
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
 * strikes. ECharts places a markLine given a numeric `xAxis` at that fractional
 * band position on a category axis — this is how the spot / max-pain verticals
 * land *between* strikes rather than snapping to one.
 */
function priceIndex(price: number | undefined, strikes: number[]): number | null {
  const n = strikes.length
  if (price === undefined || n === 0) return null
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
 * Grouped Call/Put open-interest bars on Apache ECharts (replacing the former
 * hand-rolled SVG). Preserves the three modes — Total, Change, and
 * Change+Total (solid base OI + hatched "added" / dashed "lost" segment) — plus
 * the ATM column highlight, spot & max-pain overlay lines, and a rich per-strike
 * tooltip. Follows the app's light/dark theme. Live polls mutate the existing
 * instance via setOption merge; the chart is never remounted.
 */
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
  const chartRef = useRef<EChartsReactCoreType>(null)
  const { isDark } = useTheme()
  const { showChartTooltip, callPutScheme } = usePreferences()

  const barByStrike = useMemo(() => {
    const m = new Map<number, OIBar>()
    bars.forEach((b) => m.set(b.strike, b))
    return m
  }, [bars])

  const buildOption = useCallback((): EChartsOption => {
    const C = chromeFor(isDark)
    const { call: CALL, put: PUT } = callPutColors(callPutScheme)
    const fontFamily = getComputedStyle(document.body).fontFamily
    const strikes = bars.map((b) => b.strike)
    const cats = strikes.map((s) => String(s))
    // Scale OI to lots if requested — keeps the axis consistent with the labels.
    const sc = (v: number) => (showLot ? v / Math.max(1, lotSize) : v)

    // ── Overlays: ATM band + spot / max-pain verticals ──
    const atmIdx = atmStrike !== undefined ? strikes.indexOf(atmStrike) : -1
    const spotIdx = priceIndex(spot, strikes)
    const mpIdx = priceIndex(maxPain, strikes)

    const markArea =
      atmIdx >= 0
        ? {
            silent: true,
            itemStyle: { color: C.atmCol },
            data: [[{ xAxis: cats[atmIdx] }, { xAxis: cats[atmIdx] }]] as never,
          }
        : undefined

    const markLineData: Record<string, unknown>[] = []
    if (mpIdx !== null && maxPain !== undefined) {
      markLineData.push({
        xAxis: mpIdx,
        lineStyle: { color: '#f59e0b', width: 1.25, type: [5, 3] },
        label: {
          show: true,
          position: 'start',
          formatter: `Max Pain: ${maxPain}`,
          color: '#fff',
          backgroundColor: '#b45309',
          padding: [3, 6],
          borderRadius: 4,
          fontSize: 10,
          fontWeight: 600,
        },
      })
    }
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

    // ── Series per mode ──
    const common: Partial<BarSeriesOption> = {
      type: 'bar',
      barMaxWidth: 24,
      barGap: '18%',
      barCategoryGap: '34%',
      emphasis: { focus: 'none' },
    }

    const side = (which: 'call' | 'put') => {
      const color = which === 'call' ? CALL : PUT
      const openOf = (b: OIBar) => sc(which === 'call' ? b.callOpen : b.putOpen)
      const nowOf = (b: OIBar) => sc(which === 'call' ? b.callNow : b.putNow)

      if (mode === 'total') {
        return [
          {
            ...common,
            id: `${which}`,
            name: which === 'call' ? 'Call OI' : 'Put OI',
            stack: which,
            data: bars.map((b) => ({
              value: nowOf(b),
              itemStyle: { color, borderRadius: [3, 3, 0, 0] as [number, number, number, number] },
            })),
          } as BarSeriesOption,
        ]
      }

      if (mode === 'change') {
        return [
          {
            ...common,
            id: `${which}`,
            name: which === 'call' ? 'Call OI Chg' : 'Put OI Chg',
            stack: which,
            data: bars.map((b) => {
              const inc = nowOf(b) >= openOf(b)
              const mag = Math.abs(nowOf(b) - openOf(b))
              return {
                value: mag,
                itemStyle: inc
                  ? {
                      color: alpha(color, 0.32),
                      borderColor: color,
                      borderWidth: 1,
                      borderRadius: [3, 3, 0, 0] as [number, number, number, number],
                      decal: hatchDecal(color),
                    }
                  : {
                      color: 'transparent',
                      borderColor: color,
                      borderWidth: 1.4,
                      borderType: 'dashed' as const,
                      borderRadius: [3, 3, 0, 0] as [number, number, number, number],
                    },
              }
            }),
          } as BarSeriesOption,
        ]
      }

      // change_total: solid base (min of open/now) + change segment on top.
      const base = {
        ...common,
        id: `${which}-base`,
        name: which === 'call' ? 'Call OI' : 'Put OI',
        stack: which,
        data: bars.map((b) => {
          const lo = Math.min(openOf(b), nowOf(b))
          const seg = Math.abs(nowOf(b) - openOf(b))
          return {
            value: lo,
            itemStyle: {
              color,
              borderRadius: (seg > 0 ? [0, 0, 0, 0] : [3, 3, 0, 0]) as [number, number, number, number],
            },
          }
        }),
      } as BarSeriesOption
      const segment = {
        ...common,
        id: `${which}-seg`,
        name: which === 'call' ? 'Call OI Chg' : 'Put OI Chg',
        stack: which,
        data: bars.map((b) => {
          const inc = nowOf(b) >= openOf(b)
          const mag = Math.abs(nowOf(b) - openOf(b))
          return {
            value: mag,
            itemStyle: inc
              ? {
                  color: alpha(color, 0.32),
                  borderColor: color,
                  borderWidth: 1,
                  borderRadius: [3, 3, 0, 0] as [number, number, number, number],
                  decal: hatchDecal(color),
                }
              : {
                  color: 'transparent',
                  borderColor: color,
                  borderWidth: 1.4,
                  borderType: 'dashed' as const,
                  borderRadius: [3, 3, 0, 0] as [number, number, number, number],
                },
          }
        }),
      } as BarSeriesOption
      return [base, segment]
    }

    const series = [...side('call'), ...side('put')]
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
          const b = barByStrike.get(strike)
          if (!b) return ''
          const atm = strike === atmStrike
          const chip = (color: string) =>
            `<span style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${color};margin-right:6px"></span>`
          const blk = (
            label: string,
            color: string,
            open: number,
            now: number,
            chg: number,
            pct: number,
          ) => {
            const up = chg >= 0
            const cc = up ? '#34d399' : '#fb7185'
            return (
              `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
              `<span>${chip(color)}${label} OI at ${openLabel}</span><span style="font-weight:700">${fmtOI(open, showLot, lotSize)}</span></div>` +
              `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
              `<span style="padding-left:15px">${label} OI Chg</span>` +
              `<span style="font-weight:700;color:${cc}">${fmtSignedOI(chg, showLot, lotSize)} (${up ? '+' : '−'}${Math.abs(pct).toFixed(0)}%)</span></div>` +
              `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">` +
              `<span style="padding-left:15px">${label} OI at ${nowLabel}</span><span style="font-weight:700">${fmtOI(now, showLot, lotSize)}</span></div>`
            )
          }
          return (
            `<div style="padding:9px 11px;color:${C.tipText};font-size:12px;min-width:224px">` +
            `<div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:6px">` +
            `<span>Strike: ${strike}</span>${atm ? '<span style="color:#fbbf24;font-size:10px;font-weight:700">ATM</span>' : ''}</div>` +
            blk('Call', CALL, b.callOpen, b.callNow, b.callChg, b.callChgPct) +
            `<div style="height:1px;background:${C.tipBorder};margin:6px 0"></div>` +
            blk('Put', PUT, b.putOpen, b.putNow, b.putChg, b.putChgPct) +
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
          formatter: (v: number) => (v === 0 ? '0' : fmtOI(showLot ? v * lotSize : v, showLot, lotSize)),
        },
      },
      series,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bars, mode, spot, atmStrike, maxPain, lotSize, showLot, openLabel, nowLabel, isDark, barByStrike, callPutScheme, showChartTooltip])

  const initialOption = useMemo(() => buildOption(), [])
  // Live polls / mode / theme changes mutate the existing instance. replaceMerge
  // on `series` drops old bars cleanly (mode switches change the series count);
  // the chart instance is never remounted.
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

function LegendItem({ color, kind, label }: { color: string; kind: 'solid' | 'outline' | 'hatch'; label: string }) {
  const style: React.CSSProperties =
    kind === 'solid'
      ? { background: color }
      : kind === 'outline'
        ? { border: `1.5px dashed ${color}`, background: 'transparent' }
        : {
            background: `repeating-linear-gradient(45deg, ${color} 0 2.5px, transparent 2.5px 6px)`,
            border: `1px solid ${color}`,
          }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block h-3 w-3 rounded-sm" style={style} />
      {label}
    </span>
  )
}
