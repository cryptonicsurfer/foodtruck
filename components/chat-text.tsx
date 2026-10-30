"use client"

import { Fragment, type ReactNode } from "react"

/**
 * The little Markdown the assistant writes — **bold**, headings, "- " and "1. " lists —
 * as plain React elements. No HTML is ever injected, so text from data stays text.
 */
function inline(text: string): ReactNode[] {
  // **bold** and `code` → elements; everything else stays a string
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
      <span key={i} className="font-medium">{part.slice(1, -1)}</span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    )
  )
}

export function ChatText({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const Tag = list.ordered ? "ol" : "ul"
    blocks.push(
      <Tag key={blocks.length} className={list.ordered ? "list-decimal pl-5 space-y-0.5" : "list-disc pl-5 space-y-0.5"}>
        {list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}
      </Tag>
    )
    list = null
  }
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd()
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (bullet || numbered) {
      const ordered = Boolean(numbered)
      if (list && list.ordered !== ordered) flush()
      list ??= { ordered, items: [] }
      list.items.push((bullet ?? numbered)![1])
      continue
    }
    flush()
    if (!line.trim()) continue
    const heading = line.match(/^#{1,6}\s+(.*)$/)
    blocks.push(
      heading
        ? <p key={blocks.length} className="font-semibold">{inline(heading[1])}</p>
        : <p key={blocks.length}>{inline(line)}</p>
    )
  }
  flush()
  return <div className="space-y-1.5">{blocks}</div>
}
