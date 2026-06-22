import { useLocation, useNavigate } from 'react-router-dom'

function BrainIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2z" />
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2z" />
    </svg>
  )
}

/**
 * Floating launcher that takes the user to the Copilot. Collapsed to a circle,
 * expands into a labelled pill on hover/focus. The fixed wrapper is
 * pointer-events:none so it never blocks underlying content — only the button
 * itself is interactive.
 */
export function FloatingCopilot() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  // Don't show it on the Copilot page itself.
  if (pathname.startsWith('/copilot')) return null

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-40 flex justify-end">
      <button
        type="button"
        onClick={() => navigate('/copilot')}
        aria-label="Ask AI Copilot"
        title="Ask AI Copilot"
        className="animate-fab-in pointer-events-auto group flex items-center gap-2 rounded-full bg-primary-600 p-3.5 text-white shadow-lg shadow-primary-600/30 transition-all duration-200 hover:bg-primary-700 hover:pr-5"
      >
        <BrainIcon />
        <span className="max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[120px] group-hover:opacity-100">
          Ask Copilot
        </span>
      </button>
    </div>
  )
}
