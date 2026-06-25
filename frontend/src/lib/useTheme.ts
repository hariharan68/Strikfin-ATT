import { useSyncExternalStore } from 'react'

/**
 * Theme system — three named themes.
 *   classic → default light look (blue primary)
 *   warm    → "Warm Cream" terracotta + cream surfaces
 *   dark    → full dark theme (navy slate)
 *
 * Applied as classes on <html>:
 *   dark    → `.dark`
 *   warm    → `.theme-warm`
 *   classic → no class
 *
 * A module-level store (not per-hook state) so every consumer — the
 * navbar toggle and the Settings picker — stays in sync without a
 * provider. The same logic runs in the inline bootstrap script in
 * index.html to apply the stored theme before first paint (no flash).
 */
export type Theme = 'classic' | 'warm' | 'dark'

const STORAGE_KEY = 'alphalytic-theme'
const LIGHT_PREF_KEY = 'alphalytic-theme-light'

const THEMES: readonly Theme[] = ['classic', 'warm', 'dark']

/** The dark-family themes — used by the binary navbar toggle. */
const DARK_THEMES: readonly Theme[] = ['dark']

function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (THEMES as readonly string[]).includes(v)
}

function isDarkTheme(theme: Theme): boolean {
  return (DARK_THEMES as readonly string[]).includes(theme)
}

function readStored(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  // Migrate old values.
  if (stored === 'light') return 'classic'
  if (stored === 'evil-black') return 'dark'
  return isTheme(stored) ? stored : 'classic'
}

function applyTheme(theme: Theme) {
  const el = document.documentElement
  el.classList.toggle('dark', theme === 'dark')
  el.classList.toggle('theme-warm', theme === 'warm')
}

let current: Theme = readStored()
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

export function setTheme(theme: Theme) {
  if (theme === current) return
  current = theme
  applyTheme(theme)
  localStorage.setItem(STORAGE_KEY, theme)
  // Remember the last *light* theme so the navbar toggle can restore it.
  if (!isDarkTheme(theme)) localStorage.setItem(LIGHT_PREF_KEY, theme)
  emit()
}

/** Quick navbar toggle: dark-family ⇄ last-used light theme (classic/warm). */
export function toggleDark() {
  if (isDarkTheme(current)) {
    const pref = localStorage.getItem(LIGHT_PREF_KEY)
    setTheme(isTheme(pref) && !isDarkTheme(pref) ? pref : 'classic')
  } else {
    setTheme('dark')
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot(): Theme {
  return current
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return {
    theme,
    isDark: isDarkTheme(theme),
    setTheme,
    toggle: toggleDark,
  }
}
