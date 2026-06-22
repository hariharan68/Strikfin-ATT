import { cn } from '../../lib/format'

/** Shimmering placeholder block used while data loads. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-skeleton relative overflow-hidden rounded-md bg-slate-200/80',
        className,
      )}
    >
      <div
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/70 to-transparent dark:via-white/10"
        style={{ animation: 'shimmer 1.5s infinite' }}
      />
    </div>
  )
}

/** A few stacked skeleton lines. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}
