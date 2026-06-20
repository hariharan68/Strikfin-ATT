import type { ReactNode } from 'react'
import { cn } from '../../lib/format'

interface PanelProps {
  children: ReactNode
  className?: string
}

/** White card surface with subtle border, used for every dashboard panel. */
export function Panel({ children, className }: PanelProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-slate-200 bg-white shadow-sm shadow-slate-900/[0.02] dark:shadow-black/20',
        className,
      )}
    >
      {children}
    </div>
  )
}

interface PanelHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}

export function PanelHeader({ title, subtitle, action, icon }: PanelHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-slate-400">{icon}</span>}
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}
