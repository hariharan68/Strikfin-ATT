import { api } from './client'

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
export type InstrumentId = 1 | 2

export interface Instrument {
  id: InstrumentId
  key: string
  label: string
  short: string
}

export const INSTRUMENTS: Instrument[] = [
  { id: 1, key: 'nifty', label: 'NIFTY 50', short: 'NIFTY' },
  { id: 2, key: 'sensex', label: 'SENSEX', short: 'SENSEX' },
]

/** -1 bearish, 0 neutral, 1 bullish. */
export type BiasValue = 1 | 0 | -1

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export interface User {
  id?: string
  email: string
  display_name: string
}

export interface AuthTokens {
  access_token: string
  refresh_token: string
  token_type?: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface RegisterPayload {
  email: string
  password: string
  display_name: string
}

export async function login(payload: LoginPayload): Promise<AuthTokens> {
  const { data } = await api.post<AuthTokens>('/auth/login', payload)
  return data
}

export async function register(payload: RegisterPayload): Promise<User> {
  const { data } = await api.post<User>('/auth/register', payload)
  return data
}

export async function refresh(refresh_token: string): Promise<AuthTokens> {
  const { data } = await api.post<AuthTokens>('/auth/refresh', { refresh_token })
  return data
}

export async function logout(refresh_token: string): Promise<void> {
  await api.post('/auth/logout', { refresh_token })
}

export async function getMe(): Promise<User> {
  const { data } = await api.get<User>('/auth/me')
  return data
}

// ---------------------------------------------------------------------------
// Fyers broker connection
// ---------------------------------------------------------------------------
export interface FyersLogin {
  login_url: string
  app_id?: string
  redirect_uri?: string
  instructions?: string[]
}

export interface FyersStatus {
  connected: boolean
  has_token: boolean
  message?: string
  vendor?: string
  app_id?: string
  client_id?: string
  generated_at?: string | null
}

/** Step 1 — ask the backend for the Fyers OAuth login URL. */
export async function getFyersLogin(): Promise<FyersLogin> {
  const { data } = await api.get<FyersLogin>('/auth/fyers/login')
  return data
}

/** Check whether a live Fyers token is currently active. */
export async function getFyersStatus(): Promise<FyersStatus> {
  const { data } = await api.get<FyersStatus>('/auth/fyers/status')
  return data
}

/** Disconnect — clear the stored Fyers access token. */
export async function clearFyersToken(): Promise<void> {
  await api.delete('/auth/fyers/token')
}

// ---------------------------------------------------------------------------
// Index snapshot / levels
// ---------------------------------------------------------------------------
export interface IndexSnapshot {
  instrument_id?: number
  name?: string
  symbol?: string
  ltp?: number
  price?: number
  last_price?: number
  change?: number
  change_pct?: number
  prev_close?: number
  day_high?: number
  day_low?: number
  direction?: 'UP' | 'DOWN' | 'FLAT' | string
  india_vix?: number
  atm_strike?: number
  support?: number
  resistance?: number
  pcr_oi?: number
  updated_at?: string
}

export interface IndexLevels {
  instrument_id?: number
  support?: number[]
  resistance?: number[]
  pivot?: number
}

export async function getSnapshot(id: InstrumentId): Promise<IndexSnapshot> {
  const { data } = await api.get<IndexSnapshot>(`/index/${id}/snapshot`)
  return data
}

export async function getLevels(id: InstrumentId): Promise<IndexLevels> {
  const { data } = await api.get<IndexLevels>(`/index/${id}/levels`)
  return data
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------
export interface OptionsMetrics {
  instrument_id?: number
  spot?: number
  atm_strike?: number
  pcr_oi?: number
  pcr_volume?: number
  max_pain?: number
  support?: number
  resistance?: number
  total_call_oi?: number
  total_put_oi?: number
  writing_posture?: string
  atm_iv?: number
  iv_percentile?: number
  iv_percentile_label?: string
  updated_at?: string
  net_gex?: number
  gamma_flip?: number
  gex_label?: string
}

export type BuildupLabel =
  | 'Long Build-up'
  | 'Short Build-up'
  | 'Short Covering'
  | 'Long Unwinding'
  | (string & {})

export interface OptionChainRow {
  strike: number
  type: 'CE' | 'PE'
  oi?: number
  oi_change?: number
  ltp?: number
  iv?: number
  volume?: number
  buildup?: BuildupLabel
}

export async function getOptionsMetrics(id: InstrumentId): Promise<OptionsMetrics> {
  const { data } = await api.get<Record<string, unknown>>(`/options/${id}/metrics`)
  return mapOptionsMetrics(data)
}

export async function getOptionsChain(id: InstrumentId): Promise<OptionChainRow[]> {
  const { data } = await api.get<unknown>(`/options/${id}/chain`)
  const raw = asArray<Record<string, unknown>>(data, [
    'chain_rows',
    'rows',
    'chain',
    'data',
    'options',
  ])
  return raw.map(mapChainRow)
}

/** Backend → frontend field mapping for option metrics. */
function mapOptionsMetrics(d: Record<string, unknown> | null | undefined): OptionsMetrics {
  if (!d || typeof d !== 'object') return {}
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && !Number.isNaN(v) ? v : undefined
  return {
    instrument_id: num(d.instrument_id),
    spot: num(d.spot),
    atm_strike: num(d.atm_strike),
    pcr_oi: num(d.pcr_oi),
    pcr_volume: num(d.pcr_volume),
    max_pain: num(d.max_pain) ?? num(d.max_pain_strike),
    support: num(d.support) ?? num(d.support_strike),
    resistance: num(d.resistance) ?? num(d.resistance_strike),
    total_call_oi: num(d.total_call_oi),
    total_put_oi: num(d.total_put_oi),
    writing_posture:
      typeof d.writing_posture === 'string' ? d.writing_posture : undefined,
    atm_iv: num(d.atm_iv),
    iv_percentile: num(d.iv_percentile),
    iv_percentile_label:
      typeof d.iv_percentile_label === 'string' ? d.iv_percentile_label : undefined,
          net_gex: num(d.net_gex),
    gamma_flip: num(d.gamma_flip),
    gex_label: typeof d.gex_label === 'string' ? d.gex_label : undefined,
    updated_at:
      (typeof d.snap_ts === 'string' && d.snap_ts) ||
      (typeof d.updated_at === 'string' && d.updated_at) ||
      undefined,
  }
}

const BUILDUP_LABELS: Record<string, BuildupLabel> = {
  LONG_BUILDUP: 'Long Build-up',
  SHORT_BUILDUP: 'Short Build-up',
  SHORT_COVERING: 'Short Covering',
  LONG_UNWINDING: 'Long Unwinding',
}

/** Normalise a raw build-up label (e.g. "LONG_BUILDUP") into display form. */
function humanizeBuildup(value: unknown): BuildupLabel | undefined {
  if (typeof value !== 'string' || !value) return undefined
  return BUILDUP_LABELS[value.toUpperCase()] ?? value
}

/** Backend → frontend field mapping for a single option-chain row. */
function mapChainRow(d: Record<string, unknown>): OptionChainRow {
  const num = (v: unknown): number | undefined =>
    typeof v === 'number' && !Number.isNaN(v) ? v : undefined
  const rawType = (d.type ?? d.option_type) as string | undefined
  return {
    strike: num(d.strike) ?? 0,
    type: rawType === 'PE' ? 'PE' : 'CE',
    oi: num(d.oi),
    oi_change: num(d.oi_change),
    ltp: num(d.ltp),
    iv: num(d.iv),
    volume: num(d.volume),
    buildup: humanizeBuildup(d.buildup ?? d.buildup_label),
  }
}

// ---------------------------------------------------------------------------
// Options Lab — Open Interest
// ---------------------------------------------------------------------------
export interface OILabStrike {
  strike: number
  call_oi_open: number
  call_oi_now: number
  call_oi_chg: number
  call_oi_chg_pct: number
  put_oi_open: number
  put_oi_now: number
  put_oi_chg: number
  put_oi_chg_pct: number
}

export interface OILabSentiment {
  label: string
  bullish_pct: number
  insight: string
  analysis: string
}

export interface OILabView {
  instrument_id: number
  symbol: string
  spot: number
  atm_strike: number
  max_pain: number
  lot_size: number
  pcr_oi: number
  pcr_change: number
  open_ts: string | null
  now_ts: string
  data_quality: 'intraday' | 'live_proxy' | 'empty'
  total_call_oi: number
  total_put_oi: number
  total_call_oi_chg: number
  total_put_oi_chg: number
  sentiment: OILabSentiment
  strikes: OILabStrike[]
}

export async function getOILabView(id: InstrumentId): Promise<OILabView> {
  const { data } = await api.get<OILabView>(`/options-lab/oi/${id}`)
  return data
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------
export interface SignalData {
  instrument_id?: number
  bias?: BiasValue
  label?: string
  bias_label?: string
  confidence?: number
  entry_ref?: number | string
  stop_ref?: number | string
  target_ref?: number | string
  risk_reward?: number | string
  reasoning?: string
  generated_at?: string
}

export async function getLatestSignal(id: InstrumentId): Promise<SignalData> {
  const { data } = await api.get<SignalData>(`/signals/${id}/latest`)
  return data
}

// ---------------------------------------------------------------------------
// Smart money
// ---------------------------------------------------------------------------
export interface SmartMoneySignal {
  strike: number
  option_type?: 'CE' | 'PE'
  type?: 'CE' | 'PE'
  label?: string
  signal?: string
  oi?: number
  oi_change?: number
  volume?: number
  signal_type?: number
  strength?: number
  confidence?: number
}

export interface SmartMoneyData {
  instrument_id?: number
  spot?: number
  aggregate_bias?: BiasValue
  aggregate_label?: string
  confidence?: number
  total_signals_found?: number
  summary?: string
  signals?: SmartMoneySignal[]
  as_of?: string
}

export async function getSmartMoney(id: InstrumentId): Promise<SmartMoneyData> {
  const { data } = await api.get<Record<string, unknown>>(`/smart-money/${id}`)
  return mapSmartMoney(data)
}

/** Backend → frontend field mapping for smart-money signals. */
function mapSmartMoney(d: Record<string, unknown> | null | undefined): SmartMoneyData {
  if (!d || typeof d !== 'object') return {}
  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = d[k]
      if (typeof v === 'number' && !Number.isNaN(v)) return v
    }
    return undefined
  }
  const str = (...keys: string[]): string | undefined => {
    for (const k of keys) {
      if (typeof d[k] === 'string') return d[k] as string
    }
    return undefined
  }
  const rawSignals = asArray<Record<string, unknown>>(d, ['signals', 'top_signals'])
  const signals: SmartMoneySignal[] = rawSignals.map((s) => {
    const t = (s.option_type ?? s.type) as string | undefined
    return {
      strike: typeof s.strike === 'number' ? s.strike : 0,
      option_type: t === 'PE' ? 'PE' : t === 'CE' ? 'CE' : undefined,
      label:
        (typeof s.signal_label === 'string' && s.signal_label) ||
        (typeof s.label === 'string' && s.label) ||
        (typeof s.signal === 'string' && s.signal) ||
        undefined,
      oi: typeof s.oi === 'number' ? s.oi : undefined,
      oi_change: typeof s.oi_change === 'number' ? s.oi_change : undefined,
      volume: typeof s.volume === 'number' ? s.volume : undefined,
      signal_type: typeof s.signal_type === 'number' ? s.signal_type : undefined,
      strength: typeof s.strength === 'number' ? s.strength : undefined,
      confidence: typeof s.confidence === 'number' ? s.confidence : undefined,
    }
  })
  const biasNum = num('aggregate_bias')
  return {
    instrument_id: num('instrument_id'),
    spot: num('spot'),
    aggregate_bias: (biasNum === 1 || biasNum === -1 ? biasNum : 0) as BiasValue,
    aggregate_label: str('aggregate_label', 'aggregate_bias_label'),
    confidence: num('confidence', 'aggregate_confidence'),
    total_signals_found: num('total_signals_found'),
    summary: str('summary'),
    signals,
    as_of: str('as_of'),
  }
}

// ---------------------------------------------------------------------------
// Institutional
// ---------------------------------------------------------------------------
export interface InstitutionalData {
  trade_date?: string
  fii_cash_net?: number
  dii_cash_net?: number
  fii_futures_net?: number
  fii_long_contracts?: number
  fii_short_contracts?: number
  rolling_5d?: number
  rolling_20d?: number
  interpretation?: string
  as_of?: string
  provisional?: boolean
}

export async function getInstitutional(): Promise<InstitutionalData> {
  const { data } = await api.get<Record<string, unknown>>('/institutional')
  return mapInstitutional(data)
}

/** Backend → frontend field mapping for institutional flow. */
function mapInstitutional(d: Record<string, unknown> | null | undefined): InstitutionalData {
  if (!d || typeof d !== 'object') return {}
  const num = (...keys: string[]): number | undefined => {
    for (const k of keys) {
      const v = d[k]
      if (typeof v === 'number' && !Number.isNaN(v)) return v
    }
    return undefined
  }
  const str = (k: string): string | undefined =>
    typeof d[k] === 'string' ? (d[k] as string) : undefined
  return {
    trade_date: str('trade_date'),
    fii_cash_net: num('fii_cash_net', 'fii_cash_net_cr'),
    dii_cash_net: num('dii_cash_net', 'dii_cash_net_cr'),
    fii_futures_net: num('fii_futures_net', 'fii_idx_fut_net_cr'),
    fii_long_contracts: num('fii_long_contracts'),
    fii_short_contracts: num('fii_short_contracts'),
    rolling_5d: num('rolling_5d', 'rolling_5d_fii_net'),
    rolling_20d: num('rolling_20d', 'rolling_20d_fii_net'),
    interpretation: str('interpretation'),
    as_of: str('as_of'),
    provisional:
      typeof d.provisional === 'boolean'
        ? d.provisional
        : typeof d.is_provisional === 'boolean'
          ? d.is_provisional
          : undefined,
  }
}

// ---------------------------------------------------------------------------
// Sentiment
// ---------------------------------------------------------------------------
export interface SentimentHeadline {
  headline?: string
  title?: string
  score?: number
  source?: string
  url?: string
  published_at?: string
}

export interface SentimentData {
  instrument_id?: number
  score?: number
  label?: string
  drivers?: string[]
  headlines?: SentimentHeadline[]
}

export async function getSentiment(id: InstrumentId): Promise<SentimentData> {
  const { data } = await api.get<SentimentData>(`/sentiment/${id}`)
  return data
}

// ---------------------------------------------------------------------------
// Copilot
// ---------------------------------------------------------------------------
export interface CopilotSource {
  title?: string
  ref?: string
  url?: string
  snippet?: string
}

export interface CopilotResponse {
  answer?: string
  sources?: CopilotSource[]
  question?: string
}

export interface CopilotAskPayload {
  question: string
  instrument_id: InstrumentId
}

export async function askCopilot(payload: CopilotAskPayload): Promise<CopilotResponse> {
  const { data } = await api.post<CopilotResponse>('/copilot/ask', payload)
  return data
}

// ---------------------------------------------------------------------------
// Dashboard (aggregate)
// ---------------------------------------------------------------------------
export interface AiBias {
  value?: BiasValue
  label?: string
  confidence?: number
}

export interface DashboardData {
  generated_at?: string
  updated_at?: string
  as_of?: string
  market_hours?: boolean
  indices?: IndexSnapshot[]
  nifty?: IndexSnapshot
  sensex?: IndexSnapshot
  nifty_signal?: SignalData
  sensex_signal?: SignalData
  india_vix?: number
  vix?: number
  ai_bias?: AiBias
  ai_summary?: string
  summary?: string
  options?: OptionsMetrics
  option_chain?: OptionChainRow[]
  institutional?: InstitutionalData
  disclaimer?: string
}

export async function getDashboard(): Promise<DashboardData> {
  const { data } = await api.get<DashboardData>('/dashboard')
  return data
}

// ---------------------------------------------------------------------------
// Futures
// ---------------------------------------------------------------------------
export interface FuturesSnapshot {
  instrument_id?: number
  symbol?: string
  futures_symbol?: string
  last_price?: number
  prev_close?: number
  change?: number
  change_pct?: number
  volume?: number
  open_price?: number
  high_price?: number
  low_price?: number
  snap_ts?: string
  source?: string
}

export async function getFutures(id: InstrumentId): Promise<FuturesSnapshot> {
  const { data } = await api.get<FuturesSnapshot>(`/index/${id}/futures`)
  return data
}

// ---------------------------------------------------------------------------
// Short Covering Detection
// ---------------------------------------------------------------------------
export interface ShortCoveringFactor {
  name:        string
  fired:       boolean
  value:       string
  description: string
}

export interface ShortCoveringData {
  instrument_id:        number
  status:               string   // 'Watching' | 'Early Signs' | 'Possible Rally' | 'Confirmed' | 'Strong Signal'
  score:                number   // 0–100
  confidence_pct:       number
  is_post_noon:         boolean
  verdict:              string
  recovery_pct:         number
  call_oi_change:       number
  put_oi_change:        number
  pcr:                  number
  support_level:        number | null
  near_support:         boolean
  futures_volume:       number
  day_open:             number
  day_low:              number
  day_high:             number
  ltp:                  number
  change_from_open_pct: number
  factors:              ShortCoveringFactor[]
  snap_ts:              string
}

export async function getShortCovering(id: InstrumentId): Promise<ShortCoveringData> {
  const { data } = await api.get<ShortCoveringData>(`/index/${id}/short-covering`)
  return data
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Normalise a response that may be a raw array or wrapped under a key. */
function asArray<T>(data: unknown, keys: string[]): T[] {
  if (Array.isArray(data)) return data as T[]
  if (data && typeof data === 'object') {
    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key]
      if (Array.isArray(value)) return value as T[]
    }
  }
  return []
}
