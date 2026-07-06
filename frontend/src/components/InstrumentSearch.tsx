import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Check, Search } from 'lucide-react'
import { useInstrument } from '../lib/useInstrument'
import { useInstruments, useInstrumentSearch } from '../lib/useInstruments'
import { cn } from '../lib/format'

/**
 * Global instrument search — the primary way to switch to ANY instrument.
 * A compact combobox in the navbar: click to open, type to filter via
 * GET /instruments/search, pick a result to set `?inst=`. The list is entirely
 * DB-driven, so new indexes/instruments added to the catalog appear here with
 * no frontend change. Full keyboard support (↑/↓/Home/End/↵/esc) so it stays
 * usable as the catalog grows.
 */
export function InstrumentSearch() {
  const [instrument, setInstrument] = useInstrument()
  const { catalog } = useInstruments()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const current = catalog.find((i) => i.id === instrument)

  // Backend returns the catalog head for an empty query, so this covers both
  // the "just opened" and "typing" states.
  const { data: results, isFetching } = useInstrumentSearch(query, open)
  const shown = useMemo(() => results ?? [], [results])

  // Park the keyboard highlight on the selected instrument (or first row) each
  // time the result SET changes — done during render (keyed on the id signature)
  // so it doesn't reset mid-navigation on the 15s poll refreshes.
  const [shownSig, setShownSig] = useState('')
  const sig = shown.map((m) => m.instrument_id).join(',')
  if (sig !== shownSig) {
    setShownSig(sig)
    const sel = shown.findIndex((m) => m.instrument_id === instrument)
    setHighlight(sel >= 0 ? sel : 0)
  }

  // Focus the input on open; close on outside-click.
  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Keep the highlighted row scrolled into view during keyboard nav.
  useEffect(() => {
    if (!open) return
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

  function pick(id: number) {
    setInstrument(id)
    setOpen(false)
    setQuery('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (shown.length === 0) return
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlight((h) => Math.min(h + 1, shown.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlight((h) => Math.max(h - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setHighlight(0)
        break
      case 'End':
        e.preventDefault()
        setHighlight(shown.length - 1)
        break
      case 'Enter': {
        e.preventDefault()
        const m = shown[highlight]
        if (m) pick(m.instrument_id)
        break
      }
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Search instruments"
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-500 transition-colors hover:border-primary-300 hover:text-slate-700 dark:bg-transparent"
      >
        <Search size={15} />
        <span className="hidden font-medium text-slate-700 sm:inline">
          {current?.short ?? 'Search'}
        </span>
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg shadow-slate-900/10">
          <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
            <Search size={15} className="text-slate-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search any instrument…"
              role="combobox"
              aria-controls="instrument-listbox"
              aria-expanded={open}
              aria-autocomplete="list"
              aria-activedescendant={shown[highlight] ? `inst-opt-${shown[highlight].instrument_id}` : undefined}
              className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
          </div>

          <ul
            id="instrument-listbox"
            role="listbox"
            ref={listRef}
            className="max-h-72 overflow-y-auto py-1"
          >
            {shown.length === 0 && (
              <li className="px-3 py-3 text-center text-xs text-slate-400">
                {isFetching ? 'Searching…' : 'No instruments found'}
              </li>
            )}
            {shown.map((m, i) => {
              const selected = m.instrument_id === instrument
              const highlighted = i === highlight
              return (
                <li key={m.instrument_id} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    data-idx={i}
                    id={`inst-opt-${m.instrument_id}`}
                    onMouseEnter={() => setHighlight(i)}
                    onClick={() => pick(m.instrument_id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors',
                      highlighted
                        ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/20 dark:text-primary-300'
                        : 'text-slate-700',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Check
                        size={14}
                        className={cn(
                          'shrink-0',
                          selected ? 'text-primary-600 dark:text-primary-300' : 'text-transparent',
                        )}
                      />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{m.label || m.symbol}</span>
                        <span className="truncate text-[11px] text-slate-400">{m.symbol}</span>
                      </span>
                    </span>
                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {m.exchange}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {shown.length > 0 && (
            <div className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5 text-[10px] text-slate-400">
              <span>↑↓ navigate · ↵ select · esc close</span>
              <span>{shown.length} shown</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
