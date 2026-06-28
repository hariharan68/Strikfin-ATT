import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/format'

interface DropdownProps {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  /**
   * Horizontal anchor of the panel.
   *   left / right → absolute, anchored to the trigger's edge.
   *   center       → fixed & centered in the viewport (for wide mega-menus),
   *                  with the vertical position measured from the trigger so
   *                  it still sits just below the navbar.
   */
  align?: 'left' | 'right' | 'center'
  menuClassName?: string
}

/** Click-outside / Escape-aware popover used for the navbar overflow & user menus. */
export function Dropdown({ trigger, children, align = 'right', menuClassName }: DropdownProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [centerTop, setCenterTop] = useState<number>()

  // Viewport-centered panels are `fixed`, so they need an explicit top. Measure
  // the trigger's bottom edge on open (and on resize) to anchor just below it.
  useLayoutEffect(() => {
    if (!open || align !== 'center' || !ref.current) return
    const el = ref.current
    const measure = () => setCenterTop(el.getBoundingClientRect().bottom + 8)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open, align])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const close = () => setOpen(false)

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          style={align === 'center' ? { top: centerTop } : undefined}
          className={cn(
            'z-50 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg shadow-slate-900/10 dark:shadow-black/40',
            align === 'center'
              ? 'fixed left-1/2 max-w-[95vw] -translate-x-1/2'
              : cn('absolute mt-2 min-w-[180px]', align === 'right' ? 'right-0' : 'left-0'),
            menuClassName,
          )}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

/** Shared class for a row inside a Dropdown menu (apply to <button>/<Link>). */
export const menuItemClass =
  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900'
