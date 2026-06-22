import type { ReactNode } from 'react'
import { cn } from '../../lib/format'

interface PageHeaderProps {
  title: string
  subtitle?: ReactNode
  right?: ReactNode
}

export function PageHeader({ title, subtitle, right }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {right && <div className="flex items-center gap-3">{right}</div>}
    </div>
  )
}

export function LiveBadge({ time, refreshing }: { time: string; refreshing?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600">
      <span
        className={cn(
          'h-2 w-2 rounded-full bg-emerald-500',
          refreshing ? 'animate-pulse-dot' : '',
        )}
      />
      Live — {time} IST
    </span>
  )
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-400">
      <span className="flex items-center gap-2">
        <span aria-hidden>⚠</span>
        {message}
      </span>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-400 dark:hover:bg-rose-900"
        >
          Retry
        </button>
      )}
    </div>
  )
}

function EmptyIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 3v18h18" />
      <path d="M7 14l3-3 3 3 4-5" />
    </svg>
  )
}

export function EmptyState({
  message,
  hint,
  icon,
}: {
  message: string
  hint?: string
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white px-4 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon ?? <EmptyIcon />}
      </span>
      <div>
        <p className="text-sm font-medium text-slate-500">{message}</p>
        {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      </div>
    </div>
  )
}
