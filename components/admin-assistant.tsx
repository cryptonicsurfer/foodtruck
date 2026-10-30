"use client"

/**
 * The admin assistant panel in /admin (specs/admin-assistent.md, fas 2). Shows itself
 * only when /api/admin-assistant/status says so (admin + ASSISTANT_ENABLED). The
 * conversation lives here in the browser; the server stores proposals and runs a change
 * only when the user presses Bekräfta on a card.
 */
import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Ban, Check, Loader2, MapPin, MessageSquare, RotateCcw, Send, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { SpaceMiniMap } from "@/components/space-mini-map"
import { SpaceLocationPicker } from "@/components/space-location-picker"
import { cn } from "@/lib/utils"
import type { Card, Proposal } from "@/lib/assistant/impact"

type Msg =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: unknown[] }
  | { role: "tool"; tool_call_id: string; content: string }

type Candidate = {
  id: number; name: string; address: string | null; description: string | null
  lng?: number; lat?: number; pass: string; season: string; upcoming_bookings: number
}

type UiEvent =
  | { type: "proposal"; id: string; card: Card; proposal: Proposal }
  | { type: "space_choice"; question: string; candidates: Candidate[] }

// What is drawn: text bubbles and cards, in order
type Item =
  | { kind: "text"; role: "user" | "assistant"; text: string }
  | { kind: "event"; event: UiEvent; key: string }

const EXAMPLES = [
  "Spärra Stortorget hela nästa lördag, det är marknad",
  "Vilka spärrar finns på Klittervägen i november?",
  "Lägg till en ny foodtrucker",
]

/** User text without the hidden parts the model needs ("[Idag: …]", "[plats 12]"). */
function visible(text: string): string {
  return text.replace(/^\[Idag:[^\]]*\]\n/, "").replace(/^\(Kortet[^\n]*\)\n?/gm, "").replace(/\s*\[plats \d+\]/g, "").trim()
}

export function AdminAssistant() {
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<Msg[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // Outcomes of cards, told to the model with the next message
  const notes = useRef<string[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch("/api/admin-assistant/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setEnabled(Boolean(d?.enabled)))
      .catch(() => {})
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [items, busy])

  if (!enabled) return null

  async function send(text: string, display?: string) {
    const t = text.trim()
    if (!t || busy) return
    setError("")
    const pendingNotes = notes.current
    const content = [...pendingNotes, t].join("\n")
    notes.current = []
    const next: Msg[] = [...history, { role: "user", content }]
    setItems((prev) => [...prev, { kind: "text", role: "user", text: display ?? visible(t) }])
    setInput("")
    setBusy(true)
    try {
      const res = await fetch("/api/admin-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Något gick fel.")
      const newMsgs: Msg[] = data.messages.slice(next.length)
      setHistory(data.messages)
      // Texts on the way, then the cards, then the closing line
      const texts = newMsgs.flatMap((m) => (m.role === "assistant" && m.content?.trim() ? [m.content.trim()] : []))
      const closing = data.events.length ? texts.pop() : undefined
      const added: Item[] = [
        ...texts.map((text): Item => ({ kind: "text", role: "assistant", text })),
        ...data.events.map((event: UiEvent, i: number): Item => ({ kind: "event", event, key: `${Date.now()}-${i}` })),
        ...(closing ? [{ kind: "text", role: "assistant", text: closing } as Item] : []),
      ]
      setItems((prev) => [...prev, ...added])
    } catch (e) {
      // Keep the history as it was so the user can try again
      setError((e as Error).message)
      notes.current = [...pendingNotes, ...notes.current]
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setHistory([])
    setItems([])
    setError("")
    notes.current = []
  }

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 shadow-lg rounded-full h-12 px-5 gap-2"
      >
        <MessageSquare size={18} /> Assistent
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col gap-0">
          <SheetHeader className="border-b p-4">
            <div className="flex items-center justify-between pr-8">
              <SheetTitle>Assistent</SheetTitle>
              {items.length > 0 && (
                <Button variant="ghost" size="sm" onClick={reset} disabled={busy} className="gap-1 text-xs">
                  <RotateCcw size={14} /> Nytt samtal
                </Button>
              )}
            </div>
            <SheetDescription>
              Skriv vad du vill göra. Inget ändras förrän du trycker Bekräfta på ett kort.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
            {items.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Till exempel:</p>
                {EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() => send(ex)}
                    className="block w-full text-left text-sm rounded-md border px-3 py-2 hover:bg-muted"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            )}
            {items.map((it, i) =>
              it.kind === "text" ? (
                <div
                  key={i}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm whitespace-pre-wrap max-w-[90%]",
                    it.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "bg-muted"
                  )}
                >
                  {it.text}
                </div>
              ) : it.event.type === "space_choice" ? (
                <SpaceChoiceCard key={it.key} event={it.event} disabled={busy} onAnswer={(t, d) => send(t, d)} />
              ) : (
                <ProposalCard
                  key={it.key}
                  event={it.event}
                  onDone={(note) => notes.current.push(note)}
                />
              )
            )}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={14} className="animate-spin" /> Tänker…
              </div>
            )}
            {error && <div className="rounded-md border border-red-300 bg-red-50 p-2 text-sm text-red-900">{error}</div>}
            <div ref={bottomRef} />
          </div>

          <form
            className="border-t p-3 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  send(input)
                }
              }}
              placeholder="Skriv här…"
              rows={2}
              maxLength={2000}
              className="resize-none"
              disabled={busy}
            />
            <Button type="submit" size="icon" disabled={busy || !input.trim()} aria-label="Skicka">
              <Send size={16} />
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </>
  )
}

function CandidateBody({ c }: { c: Candidate }) {
  return (
    <div className="space-y-1.5">
      {c.lng !== undefined && c.lat !== undefined && <SpaceMiniMap lng={c.lng} lat={c.lat} />}
      <p className="font-medium text-sm">{c.name}</p>
      <p className="text-xs text-muted-foreground">
        {[c.address, `pass ${c.pass}`, c.season !== "hela året" ? `säsong ${c.season}` : null, `${c.upcoming_bookings} kommande bokningar`]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  )
}

function SpaceChoiceCard({
  event,
  disabled,
  onAnswer,
}: {
  event: Extract<UiEvent, { type: "space_choice" }>
  disabled: boolean
  onAnswer: (text: string, display: string) => void
}) {
  const [showOthers, setShowOthers] = useState(false)
  const [answered, setAnswered] = useState<string | null>(null)
  const [first, ...others] = event.candidates
  if (!first) return null
  const pick = (c: Candidate) => {
    setAnswered(c.name)
    onAnswer(`Ja, ${c.name}. [plats ${c.id}]`, `Ja, ${c.name}.`)
  }

  return (
    <div className="rounded-lg border bg-white p-3 space-y-3 text-sm">
      <p className="font-medium">{event.question}</p>
      <CandidateBody c={first} />
      {answered ? (
        <p className="text-xs text-muted-foreground flex items-center gap-1"><Check size={12} /> {answered}</p>
      ) : (
        <>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => pick(first)} disabled={disabled}>Ja, den</Button>
            {!showOthers && (
              <Button size="sm" variant="outline" onClick={() => setShowOthers(true)} disabled={disabled}>Nej, en annan</Button>
            )}
          </div>
          {showOthers && (
            <div className="space-y-3 border-t pt-3">
              {others.map((c) => (
                <div key={c.id} className="space-y-2">
                  <CandidateBody c={c} />
                  <Button size="sm" variant="outline" onClick={() => pick(c)} disabled={disabled}>Den här</Button>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => {
                  setAnswered("Ingen av dem")
                  onAnswer("Ingen av de platserna. Visa andra eller fråga mig mer.", "Ingen av dem.")
                }}
              >
                Ingen av dem
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

type CardState = { status: "open" | "working" | "done" | "cancelled" | "failed"; message?: string }

function ProposalCard({
  event,
  onDone,
}: {
  event: Extract<UiEvent, { type: "proposal" }>
  onDone: (note: string) => void
}) {
  // A changed situation at Bekräfta replaces the card with a fresh one
  const [current, setCurrent] = useState(event)
  const [state, setState] = useState<CardState>({ status: "open" })
  const [typed, setTyped] = useState("")
  const [name, setName] = useState(event.proposal.kind === "create_space" ? event.proposal.name : "")
  const [email, setEmail] = useState(event.proposal.kind === "create_foodtrucker" ? event.proposal.email : "")
  const [pin, setPin] = useState(event.card.point ?? null)
  const [movingPin, setMovingPin] = useState(false)
  const { card, proposal } = current

  async function act(action: "confirm" | "cancel") {
    setState({ status: "working" })
    const edits =
      proposal.kind === "create_space" ? { name, lng: pin?.lng, lat: pin?.lat }
      : proposal.kind === "create_foodtrucker" ? { email }
      : undefined
    try {
      const res = await fetch("/api/admin-assistant/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: current.id, action, edits, typed }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.changed) {
        setCurrent({ type: "proposal", id: data.id, card: data.card, proposal: data.proposal })
        setState({ status: "open", message: data.message })
        return
      }
      if (!res.ok || data.ok === false) {
        const message = data.error || data.message || "Något gick fel."
        setState({ status: res.status === 400 ? "open" : "failed", message })
        if (res.status !== 400) onDone(`(Kortet "${card.title}" misslyckades: ${message})`)
        return
      }
      setState({ status: action === "cancel" ? "cancelled" : "done", message: data.message })
      onDone(`(Kortet "${card.title}" ${action === "cancel" ? "avbröts av användaren, inget ändrades" : `bekräftades: ${data.message}`})`)
    } catch {
      setState({ status: "open", message: "Kunde inte nå servern. Prova igen." })
    }
  }

  const open = state.status === "open"
  const point = proposal.kind === "create_space" ? pin : card.spaces?.[0]?.lng !== undefined ? { lng: card.spaces[0].lng!, lat: card.spaces[0].lat! } : null

  return (
    <div className={cn("rounded-lg border bg-white p-3 space-y-3 text-sm", state.status === "done" && "border-green-500", card.stopped && "border-red-400")}>
      <p className="font-semibold">{card.title}</p>
      {point && !movingPin && <SpaceMiniMap lng={point.lng} lat={point.lat} />}
      {proposal.kind === "create_space" && open && (
        <div className="space-y-2">
          {movingPin && <SpaceLocationPicker value={pin} onChange={(v) => v && setPin(v)} height="220px" />}
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setMovingPin(!movingPin)}>
            <MapPin size={14} /> {movingPin ? "Klar" : "Flytta nålen"}
          </Button>
          <label className="block text-xs text-muted-foreground">Namn</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </div>
      )}
      {proposal.kind === "create_foodtrucker" && open && (
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">E-post (kontrollera)</label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      )}
      <ul className="space-y-1">
        {card.lines.map((l, i) => <li key={i}>{l}</li>)}
      </ul>
      {card.warnings.map((w, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-2 rounded-md border p-2 text-xs",
            w.severity === "stopp" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-400 bg-amber-50 text-amber-950"
          )}
        >
          {w.severity === "stopp" ? <Ban size={14} className="shrink-0 mt-0.5" /> : <AlertTriangle size={14} className="shrink-0 mt-0.5" />}
          <span>{w.text}{w.detail ? ` ${w.detail}.` : ""}</span>
        </div>
      ))}
      {card.requireText && open && !card.stopped && (
        <div className="space-y-1">
          <label className="block text-xs text-muted-foreground">Skriv &quot;{card.requireText}&quot; för att bekräfta</label>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
      )}
      {state.message && (
        <p className={cn("text-xs", state.status === "done" ? "text-green-700" : state.status === "cancelled" ? "text-muted-foreground" : "text-red-700")}>
          {state.message}
        </p>
      )}
      {(open || state.status === "working") && (
        <div className="flex gap-2">
          {!card.stopped && (
            <Button
              size="sm"
              onClick={() => act("confirm")}
              disabled={state.status === "working" || (Boolean(card.requireText) && typed !== card.requireText)}
              className="gap-1"
            >
              {state.status === "working" ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Bekräfta
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => act("cancel")} disabled={state.status === "working"} className="gap-1">
            <X size={14} /> {card.stopped ? "Stäng" : "Avbryt"}
          </Button>
        </div>
      )}
    </div>
  )
}
