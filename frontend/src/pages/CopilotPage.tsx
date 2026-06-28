import { useRef, useState } from 'react'
import { Brain, Lightbulb } from 'lucide-react'
import type { FormEvent } from 'react'
import { askCopilot } from '../api/endpoints'
import type { CopilotSource } from '../api/endpoints'
import { getErrorMessage } from '../api/client'
import { useInstrument } from '../lib/useInstrument'
import { cn } from '../lib/format'
import { Disclosure } from '../components/Disclosure'
import { Markdown } from '../components/Markdown'
import { InstrumentTabs } from '../components/ui/InstrumentTabs'
import { PageHeader } from '../components/ui/Page'
import { useToast } from '../components/ui/Toast'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  content: string
  sources?: CopilotSource[]
}

const SUGGESTED = [
  'Why is NIFTY bullish today?',
  'What is the PCR reading?',
  'Where is the support zone?',
  'What is the current regime?',
  'Is Smart Money bullish or bearish?',
  'What does the PCR indicate?',
]

export function CopilotPage() {
  const [instrument, setInstrument] = useInstrument()
  const toast = useToast()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [thinking, setThinking] = useState(false)
  const idRef = useRef(0)

  async function ask(question: string) {
    const trimmed = question.trim()
    if (!trimmed || thinking) return

    const userMsg: ChatMessage = { id: ++idRef.current, role: 'user', content: trimmed }
    setMessages((m) => [...m, userMsg])
    setInput('')
    setThinking(true)
    try {
      const res = await askCopilot({ question: trimmed, instrument_id: instrument })
      setMessages((m) => [
        ...m,
        {
          id: ++idRef.current,
          role: 'assistant',
          content: res.answer ?? 'No answer was returned.',
          sources: res.sources,
        },
      ])
    } catch (err) {
      const message = getErrorMessage(err, 'Copilot is unavailable right now')
      toast.error(message)
      setMessages((m) => [
        ...m,
        { id: ++idRef.current, role: 'assistant', content: `⚠ ${message}` },
      ])
    } finally {
      setThinking(false)
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(input)
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-3xl flex-col">
      <PageHeader
        title="AI Copilot"
        subtitle="Ask about market structure, options & flow"
        right={<InstrumentTabs value={instrument} onChange={setInstrument} />}
      />

      {/* Conversation */}
      <div className="flex-1 space-y-4 overflow-y-auto rounded-xl border border-slate-200 bg-white p-5">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full w-full max-w-lg flex-col items-center justify-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100 text-primary-600">
              <Brain size={28} />
            </span>
            <p className="mt-4 text-base font-semibold text-slate-800">Ask the Copilot anything</p>
            <p className="mt-1 text-xs text-slate-400">
              It answers from live market data for the selected index.
            </p>
            <div className="mt-6 w-full">
              <p className="mb-2 flex items-center gap-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <Lightbulb size={13} /> Try asking:
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {SUGGESTED.map((q) => (
                  <button
                    key={q}
                    onClick={() => ask(q)}
                    className="press rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-600 hover:border-primary-300 hover:bg-primary-50 hover:text-primary-700"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-100 text-slate-700',
                )}
              >
                {msg.role === 'assistant' ? (
                  <Markdown>{msg.content}</Markdown>
                ) : (
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                )}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="mt-2 border-t border-slate-200 pt-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Sources
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {msg.sources.map((s, i) => (
                        <li key={i} className="text-xs text-slate-500">
                          • {s.title ?? s.ref ?? s.url ?? s.snippet ?? 'source'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))
        )}

        {thinking && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-slate-100 px-4 py-2.5 text-sm text-slate-400">
              Thinking…
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="mt-3 flex items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about NIFTY / SENSEX…"
          className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
        />
        <button
          type="submit"
          disabled={thinking || !input.trim()}
          className="press rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Ask
        </button>
      </form>

      <div className="mt-3">
        <Disclosure>
          Copilot answers are AI-generated from automated market data and may be inaccurate or
          delayed. This is not investment advice. Strikfin is not a SEBI-registered investment
          adviser.
        </Disclosure>
      </div>
    </div>
  )
}
