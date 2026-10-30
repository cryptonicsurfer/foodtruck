/**
 * POST /api/admin-assistant — one assistant turn. Admin only (guard). The browser
 * keeps the conversation and sends it with every request; the reply is the updated
 * conversation plus UI events (confirm cards, space choices). Nothing is written here
 * except the proposal log — changes run in ./confirm.
 */
import { NextResponse } from "next/server"
import { guard } from "@/lib/assistant/guard"
import { chat, llmConfigured, type ChatMessage } from "@/lib/assistant/llm"
import { SYSTEM_PROMPT } from "@/lib/assistant/prompt"
import { TOOLS, runTool, loadSnapshot, todayStockholm, type UiEvent } from "@/lib/assistant/tools"
import { validateHistory, withToday, HistoryError } from "@/lib/assistant/history"
import type { Snapshot } from "@/lib/assistant/impact"

export const dynamic = "force-dynamic"
const MAX_STEPS = 8

export async function POST(req: Request) {
  const g = await guard(req, "chat")
  if (g instanceof NextResponse) return g
  if (!llmConfigured()) return NextResponse.json({ error: "Assistenten är inte konfigurerad." }, { status: 503 })

  let messages: ChatMessage[]
  try {
    const body = await req.json()
    messages = withToday(validateHistory(body?.messages), todayStockholm())
  } catch (e) {
    const msg = e instanceof HistoryError ? e.message : "Felaktig förfrågan"
    return NextResponse.json({ error: msg }, { status: 400 })
  }

  // The log keeps what the user asked in this conversation, not just the last click
  const asked = messages
    .filter((m): m is { role: "user"; content: string } => m.role === "user")
    .map((m) => m.content.replace(/^\[Idag:[^\]]*\]\n/, ""))
    .join("\n")
  const ctx = { token: g.token, userId: g.userId, prompt: asked.slice(-2000) }
  // One snapshot per request, loaded on the first tool call that needs data
  let snapshot: Promise<Snapshot> | null = null
  const getData = () => (snapshot ??= loadSnapshot(g.token))

  // The client appends exactly what this request added (the history may have been trimmed)
  const sentCount = messages.length
  const events: UiEvent[] = []
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const { message } = await chat([{ role: "system", content: SYSTEM_PROMPT }, ...messages], TOOLS, g.userId)
      messages = [...messages, message]
      if (!message.tool_calls?.length) break
      let ends = false
      for (const call of message.tool_calls) {
        // Only one card per turn: later propose/ask calls in the same message are refused
        if (ends && (call.function.name.startsWith("propose_") || call.function.name === "ask_which_space")) {
          messages.push({ role: "tool", tool_call_id: call.id, content: "Inte utfört: ett förslag per tur." })
          continue
        }
        const r = await runTool(call.function.name, call.function.arguments, ctx, getData)
        messages.push({ role: "tool", tool_call_id: call.id, content: r.forModel })
        if (r.ui) events.push(r.ui)
        if (r.endsTurn) ends = true
      }
      if (ends) {
        // Close the turn with a visible line (and keep tool → user out of the history; Mistral refuses it)
        const last = events[events.length - 1]
        const text =
          message.content?.trim() ||
          (last?.type === "space_choice" ? last.question : last?.message) ||
          "Här är mitt förslag. Kontrollera kortet och tryck Bekräfta eller Avbryt."
        messages.push({ role: "assistant", content: text })
        break
      }
      if (step === MAX_STEPS - 1) {
        messages.push({ role: "assistant", content: "Jag kom inte fram till något förslag. Kan du säga det på ett annat sätt?" })
      }
    }
  } catch (e) {
    console.error("[assistant] turn failed:", (e as Error).message)
    return NextResponse.json({ error: "Assistenten svarar inte just nu. Prova igen om en stund." }, { status: 502 })
  }

  return NextResponse.json({ messages, added: messages.slice(sentCount), events })
}
