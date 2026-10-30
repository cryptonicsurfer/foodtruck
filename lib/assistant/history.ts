/**
 * The conversation lives in the browser and is sent with every request, so it is
 * untrusted input: validated here, size-capped, trimmed. Forging it only fools the
 * model — proposals are stored server-side and Bekräfta runs the stored one.
 */
import type { ChatMessage } from "./llm.ts"

const MAX_MESSAGES = 60
const MAX_USER_CHARS = 2000
const MAX_CONTENT_CHARS = 14000
const MAX_TOTAL_CHARS = 200_000

export class HistoryError extends Error {}

export function validateHistory(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new HistoryError("Tomt samtal")
  if (JSON.stringify(raw).length > MAX_TOTAL_CHARS) throw new HistoryError("Samtalet är för långt. Börja ett nytt.")
  const out: ChatMessage[] = raw.map((m: any) => {
    const content = typeof m?.content === "string" ? m.content : null
    switch (m?.role) {
      case "user":
        if (!content?.trim()) throw new HistoryError("Tomt meddelande")
        return { role: "user", content: content.slice(0, MAX_CONTENT_CHARS) }
      case "assistant": {
        const calls = Array.isArray(m.tool_calls)
          ? m.tool_calls.map((c: any) => {
              if (typeof c?.id !== "string" || typeof c?.function?.name !== "string") throw new HistoryError("Felaktigt verktygsanrop")
              return { id: c.id.slice(0, 100), type: "function" as const, function: { name: c.function.name.slice(0, 60), arguments: String(c.function.arguments ?? "").slice(0, MAX_CONTENT_CHARS) } }
            })
          : undefined
        return { role: "assistant", content: content?.slice(0, MAX_CONTENT_CHARS) ?? null, ...(calls?.length ? { tool_calls: calls } : {}) }
      }
      case "tool":
        if (typeof m.tool_call_id !== "string") throw new HistoryError("Felaktigt verktygssvar")
        return { role: "tool", tool_call_id: m.tool_call_id.slice(0, 100), content: (content ?? "").slice(0, MAX_CONTENT_CHARS) }
      default:
        throw new HistoryError("Okänd roll") // no "system" from the client, ever
    }
  })
  const last = out[out.length - 1]
  if (last.role !== "user") throw new HistoryError("Sista meddelandet ska vara användarens")
  if (last.content.length > MAX_USER_CHARS) throw new HistoryError(`Skriv kortare (högst ${MAX_USER_CHARS} tecken).`)
  return trimHistory(out)
}

/** Keep the last MAX_MESSAGES, starting at a user message so tool calls and results stay paired. */
export function trimHistory(msgs: ChatMessage[]): ChatMessage[] {
  if (msgs.length <= MAX_MESSAGES) return msgs
  let start = msgs.length - MAX_MESSAGES
  while (start < msgs.length - 1 && msgs[start].role !== "user") start++
  return msgs.slice(start)
}

/** "[Idag: fredag 2026-10-30]" in front of the newest user message (once). */
export function withToday(msgs: ChatMessage[], today: string): ChatMessage[] {
  const last = msgs[msgs.length - 1]
  if (last.role !== "user" || last.content.startsWith("[Idag:")) return msgs
  const weekday = new Intl.DateTimeFormat("sv-SE", { weekday: "long", timeZone: "UTC" }).format(new Date(`${today}T12:00:00Z`))
  return [...msgs.slice(0, -1), { role: "user", content: `[Idag: ${weekday} ${today}]\n${last.content}` }]
}
