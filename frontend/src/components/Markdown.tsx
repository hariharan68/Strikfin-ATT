import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../lib/format'

const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|`[^`]+`)/g

/** Render inline markdown: **bold**, __bold__, *italic*, `code`. */
function inline(text: string, keyBase: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter((p) => p !== '')
    .map((p, i) => {
      const key = `${keyBase}-${i}`
      if (/^\*\*[\s\S]+\*\*$/.test(p) || /^__[\s\S]+__$/.test(p)) {
        return <strong key={key}>{p.slice(2, -2)}</strong>
      }
      if (/^\*[\s\S]+\*$/.test(p)) return <em key={key}>{p.slice(1, -1)}</em>
      if (/^`[\s\S]+`$/.test(p)) {
        return (
          <code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-[0.85em] text-slate-700">
            {p.slice(1, -1)}
          </code>
        )
      }
      return <Fragment key={key}>{p}</Fragment>
    })
}

/**
 * Lightweight, dependency-free markdown renderer for AI-generated text.
 * Handles paragraphs, bullet lists (- / *), #/##/### headings and inline marks.
 * Used wherever model output is shown so raw `**asterisks**` never leak through.
 */
export function Markdown({ children, className }: { children?: string | null; className?: string }) {
  const text = (children ?? '').trim()
  if (!text) return null

  const blocks: ReactNode[] = []
  let list: string[] = []
  let k = 0

  const flushList = () => {
    if (list.length === 0) return
    const items = [...list]
    blocks.push(
      <ul key={`ul-${k++}`} className="ml-4 list-disc space-y-1">
        {items.map((it, i) => (
          <li key={i}>{inline(it, `li-${k}-${i}`)}</li>
        ))}
      </ul>,
    )
    list = []
  }

  for (const raw of text.split(/\n/)) {
    const line = raw.trim()
    if (!line) {
      flushList()
      continue
    }
    const bullet = line.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      list.push(bullet[1])
      continue
    }
    flushList()
    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      blocks.push(
        <p key={`h-${k++}`} className="font-semibold text-slate-800">
          {inline(heading[2], `h-${k}`)}
        </p>,
      )
    } else {
      blocks.push(<p key={`p-${k++}`}>{inline(line, `p-${k}`)}</p>)
    }
  }
  flushList()

  return <div className={cn('space-y-2 leading-relaxed', className)}>{blocks}</div>
}
