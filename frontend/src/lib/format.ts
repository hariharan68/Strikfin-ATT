import type { BiasValue } from '../api/endpoints'

/** Join conditional class names. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

function isBad(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'number' && Number.isNaN(value))
}

/** Fixed-decimal number with Indian digit grouping. */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (isBad(value)) return '—'
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value as number)
}

/** Integer with grouping (e.g. open interest). */
export function formatInt(value: number | null | undefined): string {
  if (isBad(value)) return '—'
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value as number)
}

/** Compact integer (1.2L, 3.4Cr style via en-IN). */
export function formatCompact(value: number | null | undefined): string {
  if (isBad(value)) return '—'
  return new Intl.NumberFormat('en-IN', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(value as number)
}

/** Signed number, e.g. +124.50 / −88.20. */
export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (isBad(value)) return '—'
  const v = value as number
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}${formatNumber(Math.abs(v), digits)}`
}

/** Percent value already in percent units (e.g. 1.24 -> "1.24%"). */
export function formatPct(value: number | null | undefined, digits = 2): string {
  if (isBad(value)) return '—'
  return `${formatNumber(value, digits)}%`
}

/** Signed percent (e.g. +1.24% / −0.88%). */
export function formatSignedPct(value: number | null | undefined, digits = 2): string {
  if (isBad(value)) return '—'
  const v = value as number
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}${formatNumber(Math.abs(v), digits)}%`
}

/** Money in crores, e.g. +₹1,234 Cr. */
export function formatCrore(value: number | null | undefined): string {
  if (isBad(value)) return '—'
  const v = value as number
  const sign = v > 0 ? '+' : v < 0 ? '−' : ''
  return `${sign}₹${formatInt(Math.abs(v))} Cr`
}

/** Time of day in IST (24h). */
export function formatTimeIST(input?: string | number | Date): string {
  const d = input ? new Date(input) : new Date()
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(d)
}

/** Date + time of day in IST, e.g. "15 Jun 2026, 17:34". */
export function formatDateTimeIST(input?: string | number | Date): string {
  if (!input) return '—'
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Kolkata',
  }).format(d)
}

export type Tone = 'bull' | 'bear' | 'neutral'

/** Normalise a bias value or label into -1 / 0 / 1. */
export function normalizeBias(bias?: BiasValue | number | string | null): BiasValue {
  if (typeof bias === 'number') {
    if (bias > 0) return 1
    if (bias < 0) return -1
    return 0
  }
  if (typeof bias === 'string') {
    const s = bias.toLowerCase()
    if (s.includes('bull') || s.includes('long') || s.includes('positive')) return 1
    if (s.includes('bear') || s.includes('short') || s.includes('negative')) return -1
  }
  return 0
}

export function biasToTone(bias: BiasValue): Tone {
  return bias > 0 ? 'bull' : bias < 0 ? 'bear' : 'neutral'
}

export function biasLabel(bias: BiasValue): string {
  return bias > 0 ? 'Bullish' : bias < 0 ? 'Bearish' : 'Neutral'
}

/** Tailwind class sets per tone, reused across pills/badges. */
export const toneClasses: Record<Tone, { soft: string; text: string; dot: string; bar: string }> = {
  bull: {
    soft: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    text: 'text-emerald-600',
    dot: 'bg-emerald-500',
    bar: 'bg-emerald-500',
  },
  bear: {
    soft: 'bg-rose-50 text-rose-700 ring-rose-200',
    text: 'text-rose-600',
    dot: 'bg-rose-500',
    bar: 'bg-rose-500',
  },
  neutral: {
    soft: 'bg-amber-50 text-amber-700 ring-amber-200',
    text: 'text-amber-600',
    dot: 'bg-amber-500',
    bar: 'bg-amber-500',
  },
}

/** Convert a confidence value that may be 0–1 or 0–100 into a 0–100 percent. */
export function toPercent(value: number | null | undefined): number {
  if (isBad(value)) return 0
  const v = value as number
  const pct = v <= 1 ? v * 100 : v
  return Math.max(0, Math.min(100, Math.round(pct)))
}
