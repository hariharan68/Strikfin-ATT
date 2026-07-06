import { useSyncExternalStore } from 'react'

/**
 * Chart-related user preferences (the Settings → Global Settings panel).
 *
 * A module-level store — not per-hook state — mirroring `useTheme.ts`, so every
 * consumer (the settings panel and the chart components) stays in sync without a
 * provider. Seeded from `localStorage` for instant reads, then reconciled from
 * the server after login (`session.ts:applyServerPreferences`). The PUT to the
 * backend is owned by the settings panel; this store only holds client state.
 */
export type CallPutScheme = 'classic' | 'inverted'

export interface Preferences {
  showChartTooltip: boolean
  callPutScheme: CallPutScheme
}

const STORAGE_KEY = 'strikfin-prefs'

const DEFAULTS: Preferences = {
  showChartTooltip: true,
  callPutScheme: 'classic',
}

/** Canonical call/put colours; `inverted` swaps which side is green vs red. */
const CALL_GREEN = '#22c55e' // green-500
const PUT_RED = '#ef4444' // red-500

export function callPutColors(scheme: CallPutScheme): { call: string; put: string } {
  return scheme === 'inverted'
    ? { call: PUT_RED, put: CALL_GREEN }
    : { call: CALL_GREEN, put: PUT_RED }
}

function readStored(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Preferences>
    return {
      showChartTooltip:
        typeof parsed.showChartTooltip === 'boolean'
          ? parsed.showChartTooltip
          : DEFAULTS.showChartTooltip,
      callPutScheme:
        parsed.callPutScheme === 'inverted' || parsed.callPutScheme === 'classic'
          ? parsed.callPutScheme
          : DEFAULTS.callPutScheme,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let current: Preferences = readStored()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Storage unavailable (private mode etc.) — keep the in-memory value.
  }
}

/** Merge a partial update, persist to localStorage, and notify consumers. */
export function setPreferences(partial: Partial<Preferences>) {
  const next = { ...current, ...partial }
  if (next.showChartTooltip === current.showChartTooltip && next.callPutScheme === current.callPutScheme) {
    return
  }
  current = next
  persist()
  emit()
}

/** Seed from the server response (login/restore). Same merge semantics; skips
 *  undefined fields so a partial server payload won't clobber defaults. */
export function applyPreferencesFromServer(prefs: Partial<Preferences>) {
  const clean: Partial<Preferences> = {}
  if (typeof prefs.showChartTooltip === 'boolean') clean.showChartTooltip = prefs.showChartTooltip
  if (prefs.callPutScheme === 'classic' || prefs.callPutScheme === 'inverted') {
    clean.callPutScheme = prefs.callPutScheme
  }
  setPreferences(clean)
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot(): Preferences {
  return current
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
