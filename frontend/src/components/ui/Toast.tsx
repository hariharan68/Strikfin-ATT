import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../../lib/format'

type ToastType = 'error' | 'success' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void
  error: (message: string) => void
  success: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const TONE: Record<ToastType, { ring: string; icon: string; iconColor: string }> = {
  error: { ring: 'border-rose-200', icon: '⚠', iconColor: 'text-rose-500' },
  success: { ring: 'border-emerald-200', icon: '✓', iconColor: 'text-emerald-500' },
  info: { ring: 'border-primary-200', icon: 'ℹ', iconColor: 'text-primary-600' },
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = Date.now() + Math.random()
      setToasts((current) => [...current, { id, message, type }])
      window.setTimeout(() => remove(id), 4500)
    },
    [remove],
  )

  const value = useMemo<ToastContextValue>(
    () => ({
      toast,
      error: (m: string) => toast(m, 'error'),
      success: (m: string) => toast(m, 'success'),
    }),
    [toast],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 top-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            onClick={() => remove(t.id)}
            className={cn(
              'animate-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border bg-white px-4 py-3 text-left shadow-lg shadow-slate-900/5',
              TONE[t.type].ring,
            )}
          >
            <span className={cn('mt-0.5 text-sm font-bold', TONE[t.type].iconColor)}>
              {TONE[t.type].icon}
            </span>
            <span className="text-sm leading-snug text-slate-700">{t.message}</span>
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
