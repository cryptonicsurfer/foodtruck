/**
 * analyzeImpact — what a proposed change would do, as a confirm card.
 * Pure: takes the proposal and a snapshot of the data, returns the card. Runs when the
 * assistant proposes and again at Bekräfta (if the card changed, nothing is executed).
 * Built on lib/booking-rules.ts so the admin dialogs and the assistant agree.
 */
import {
  bookingsUnderBlock, bookingsOutsideSlots, blocksChangingReach, slotsCoveredByBlock,
  shortTimeRange, type BlockSlot,
} from "../booking-rules.ts"
import { POLICY, policyRule, type PolicyRuleId, type PolicySeverity } from "../foodtruck-policy.ts"

export type Slot = { start: string; end: string; description?: string }

export type Proposal =
  | { kind: "block"; space_ids: number[]; dates: string[]; time_slot: BlockSlot; reason?: string }
  | { kind: "unblock"; block_ids: number[] }
  | { kind: "update_space"; space_id: number; changes: { name?: string; description?: string | null; time_slots?: Slot[]; bookable_from?: string | null; bookable_to?: string | null } }
  | { kind: "create_space"; name: string; description?: string | null; lng: number; lat: number; address?: string | null; time_slots: Slot[]; bookable_from?: string | null; bookable_to?: string | null; aliases?: string[] }
  | { kind: "add_alias"; space_id: number; alias: string }
  | { kind: "update_rules"; changes: { maximum_future_bookings?: number; maximum_days_ahead?: number; last_minute_booking_hours?: number } }
  | { kind: "create_foodtrucker"; first_name: string; last_name: string; email: string; foodtruck_name: string; description?: string | null }
  | { kind: "set_foodtruck_active"; foodtruck_id: number; active: boolean }
  | { kind: "delete_foodtrucker"; foodtruck_id: number; delete_user: boolean }

export type ProposalKind = Proposal["kind"]

export type Snapshot = {
  today: string // yyyy-MM-dd, Europe/Stockholm
  spaces: any[]
  bookings: any[] // future bookings, with space + foodtruck expanded
  blocks: any[] // non-archived space_blocked_dates
  foodtrucks: any[] // with user.{id,email,first_name,last_name}
  rules: any | null
}

export type CardWarning = { rule?: PolicyRuleId; severity: PolicySeverity; text: string; detail?: string }
export type CardSpace = { id: number; name: string; address?: string | null; lng?: number; lat?: number }

export type Card = {
  title: string
  lines: string[]
  warnings: CardWarning[]
  spaces?: CardSpace[]
  point?: { lng: number; lat: number }
  /** Exact word the user must type before Bekräfta (destructive actions) */
  requireText?: string
  /** True when a "stopp" rule fires — the card gets no Bekräfta button */
  stopped: boolean
}

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]

/** "2026-11-09" → "9 nov 2026" */
export function svDate(d: string): string {
  const [y, m, day] = d.slice(0, 10).split("-").map(Number)
  return `${day} ${MONTHS[m - 1]} ${y}`
}

/** Dates as compact ranges: "9–12 nov 2026, 20 nov 2026" */
export function svDates(dates: string[]): string {
  const sorted = [...new Set(dates)].sort()
  const out: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && nextDay(sorted[j]) === sorted[j + 1]) j++
    out.push(i === j ? svDate(sorted[i]) : rangeLabel(sorted[i], sorted[j]))
    i = j + 1
  }
  return out.length > 6 ? `${out.slice(0, 6).join(", ")} och ${out.length - 6} perioder till` : out.join(", ")
}

function rangeLabel(a: string, b: string): string {
  const [ya, ma] = a.split("-"), [yb, mb] = b.split("-")
  const da = Number(a.slice(8)), db = Number(b.slice(8))
  if (ya === yb && ma === mb) return `${da}–${db} ${MONTHS[Number(ma) - 1]} ${ya}`
  if (ya === yb) return `${da} ${MONTHS[Number(ma) - 1]}–${db} ${MONTHS[Number(mb) - 1]} ${yb}`
  return `${svDate(a)}–${svDate(b)}`
}

export function nextDay(d: string): string {
  const t = new Date(`${d}T12:00:00Z`)
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

/** All dates from..to inclusive (max `cap` days). */
export function expandDates(from: string, to: string, cap = 400): string[] {
  const out: string[] = []
  for (let d = from; d <= to && out.length < cap; d = nextDay(d)) out.push(d)
  return out
}

export const SLOT_LABEL: Record<BlockSlot, string> = {
  all_day: "hela dagen",
  morning: "pass som börjar före 16",
  evening: "pass som börjar 16 eller senare",
}

const spaceId = (x: any) => Number(x?.id ?? x)
const hhmm = (t: string) => String(t).slice(0, 5)

export function cardSpace(s: any): CardSpace {
  const c = s?.location?.coordinates
  return { id: Number(s.id), name: s.name, address: s.address ?? null, ...(c ? { lng: c[0], lat: c[1] } : {}) }
}

function warn(rule: PolicyRuleId, detail?: string): CardWarning {
  const r = policyRule(rule)
  return { rule, severity: r.severity, text: r.text, ...(detail ? { detail } : {}) }
}

function bookingLabel(b: any): string {
  return `${b.foodtruck?.name ?? "Okänd foodtruck"} ${svDate(b.start)} (${shortTimeRange(b.start, b.end)})`
}

function list(items: string[], max = 6): string {
  return items.length > max ? `${items.slice(0, max).join(", ")} och ${items.length - max} till` : items.join(", ")
}

function slotsLabel(slots: Slot[] | null | undefined): string {
  return (slots ?? []).length ? (slots ?? []).map((s) => shortTimeRange(s.start, s.end)).join(" + ") : "inga pass"
}

function seasonLabel(from?: string | null, to?: string | null): string {
  if (!from && !to) return "hela året"
  return `${from ? svDate(from) : "…"}–${to ? svDate(to) : "…"}`
}

export function analyzeImpact(p: Proposal, data: Snapshot): Card {
  const spaceById = new Map(data.spaces.map((s) => [Number(s.id), s]))
  const truckById = new Map(data.foodtrucks.map((t) => [Number(t.id), t]))
  const warnings: CardWarning[] = []
  const lines: string[] = []
  let card: Omit<Card, "warnings" | "lines" | "stopped">

  switch (p.kind) {
    case "block": {
      const spaces = p.space_ids.map((id) => spaceById.get(id)).filter(Boolean)
      const past = p.dates.filter((d) => d < data.today)
      if (past.length) warnings.push(warn("past-date", svDates(past)))
      for (const s of spaces) {
        if ((s.time_slots ?? []).length && slotsCoveredByBlock(s.time_slots, p.time_slot).length === 0) {
          warnings.push(warn("block-no-effect", `${s.name} har passen ${slotsLabel(s.time_slots)}`))
        }
      }
      const hits = spaces.flatMap((s) => bookingsUnderBlock(data.bookings, s.id, p.dates, p.time_slot))
      if (hits.length) warnings.push(warn("block-on-booking", list(hits.map((b) => `${bookingLabel(b)}, ${b.space?.name ?? ""}`))))
      // Days already blocked for the same slot (or all day) are skipped at Bekräfta
      const already = spaces.flatMap((s) =>
        data.blocks
          .filter((b) => spaceId(b.space) === Number(s.id) && p.dates.includes(b.date) && (b.time_slot === "all_day" || b.time_slot === p.time_slot))
          .map((b) => `${s.name} ${svDate(b.date)}`)
      )
      const total = spaces.length * p.dates.length - already.length
      lines.push(`Platser: ${spaces.map((s) => s.name).join(", ")}`)
      lines.push(`Datum: ${svDates(p.dates)} (${p.dates.length} ${p.dates.length === 1 ? "dag" : "dagar"})`)
      lines.push(`Gäller: ${SLOT_LABEL[p.time_slot]}`)
      if (p.reason) lines.push(`Orsak: ${p.reason}`)
      if (already.length) lines.push(`Redan spärrat, hoppas över: ${list(already)}`)
      lines.push(`Skapar ${total} ${total === 1 ? "spärr" : "spärrar"}.`)
      card = { title: "Spärra datum", spaces: spaces.map(cardSpace) }
      break
    }
    case "unblock": {
      const found = data.blocks.filter((b) => p.block_ids.includes(Number(b.id)))
      const names = found.map((b) => `${spaceById.get(spaceId(b.space))?.name ?? b.space?.name ?? "?"} ${svDate(b.date)} (${SLOT_LABEL[b.time_slot as BlockSlot] ?? b.time_slot})${b.reason ? ` "${b.reason}"` : ""}`)
      lines.push(`Tar bort ${found.length} ${found.length === 1 ? "spärr" : "spärrar"}: ${list(names, 10)}`)
      if (found.length < p.block_ids.length) lines.push(`${p.block_ids.length - found.length} av spärrarna finns inte längre och hoppas över.`)
      lines.push("Dagarna blir bokningsbara igen.")
      const ids = [...new Set(found.map((b) => spaceId(b.space)))]
      card = { title: "Häv spärrar", spaces: ids.map((id) => spaceById.get(id)).filter(Boolean).map(cardSpace) }
      break
    }
    case "update_space": {
      const s = spaceById.get(p.space_id)
      const c = p.changes
      if (c.name !== undefined) lines.push(`Namn: ${s?.name} → ${c.name}`)
      if (c.description !== undefined) lines.push(`Beskrivning: "${s?.description ?? ""}" → "${c.description ?? ""}"`)
      if (c.time_slots !== undefined) {
        lines.push(`Pass: ${slotsLabel(s?.time_slots)} → ${slotsLabel(c.time_slots)}`)
        const future = data.bookings.filter((b) => spaceId(b.space) === p.space_id)
        const orphans = bookingsOutsideSlots(future, c.time_slots)
        if (orphans.length) warnings.push(warn("slots-orphan-bookings", list(orphans.map(bookingLabel))))
        const reach = blocksChangingReach(
          data.blocks.filter((b) => spaceId(b.space) === p.space_id && b.date >= data.today),
          s?.time_slots, c.time_slots
        )
        if (reach.length) {
          const how = { none: "slutar gälla", some: "gäller bara en del av dagen", all: "gäller hela dagen" } as const
          warnings.push(warn("slots-block-reach", list(reach.map((r) => `${svDate(r.block.date)} ${how[r.after]}`))))
        }
        if (!matchesTemplate(c.time_slots)) warnings.push(warn("slots-off-template"))
      }
      if (c.bookable_from !== undefined || c.bookable_to !== undefined) {
        const from = c.bookable_from !== undefined ? c.bookable_from : s?.bookable_from
        const to = c.bookable_to !== undefined ? c.bookable_to : s?.bookable_to
        lines.push(`Säsong: ${seasonLabel(s?.bookable_from, s?.bookable_to)} → ${seasonLabel(from, to)}`)
      }
      card = { title: `Ändra ${s?.name ?? "plats"}`, spaces: s ? [cardSpace(s)] : [] }
      break
    }
    case "create_space": {
      lines.push(`Namn: ${p.name}`)
      if (p.address) lines.push(`Adress: ${p.address}`)
      lines.push(`Pass: ${slotsLabel(p.time_slots)}`)
      lines.push(`Säsong: ${seasonLabel(p.bookable_from, p.bookable_to)}`)
      if (p.description) lines.push(`Beskrivning: ${p.description}`)
      if (p.aliases?.length) lines.push(`Smeknamn: ${p.aliases.join(", ")}`)
      if (!matchesTemplate(p.time_slots)) warnings.push(warn("slots-off-template"))
      card = { title: "Ny plats", point: { lng: p.lng, lat: p.lat } }
      break
    }
    case "add_alias": {
      const s = spaceById.get(p.space_id)
      lines.push(`"${p.alias}" sparas som smeknamn för ${s?.name}, så hittar assistenten platsen direkt nästa gång.`)
      card = { title: "Spara smeknamn", spaces: s ? [cardSpace(s)] : [] }
      break
    }
    case "update_rules": {
      const label: Record<string, string> = {
        maximum_future_bookings: "Max antal framtida bokningar",
        maximum_days_ahead: "Max dagar framåt",
        last_minute_booking_hours: "Sista-minuten-bokning (timmar)",
      }
      for (const [k, v] of Object.entries(p.changes)) lines.push(`${label[k] ?? k}: ${data.rules?.[k] ?? "–"} → ${v}`)
      card = { title: "Ändra bokningsregler" }
      break
    }
    case "create_foodtrucker": {
      lines.push(`Foodtruck: ${p.foodtruck_name}`)
      lines.push(`Ägare: ${p.first_name} ${p.last_name}, ${p.email}`)
      lines.push("Kontot skapas utan lösenord. Ägaren får ett mejl och väljer sitt eget lösenord.")
      const dupMail = data.foodtrucks.find((t) => t.user?.email?.toLowerCase() === p.email.toLowerCase())
      const dupName = data.foodtrucks.find((t) => normalizeName(t.name) === normalizeName(p.foodtruck_name))
      if (dupMail) warnings.push({ severity: "stopp", text: `E-postadressen har redan en foodtruck (${dupMail.name}).` })
      if (dupName) warnings.push({ severity: "varning", text: `Det finns redan en foodtruck som heter ${dupName.name}${dupName.active === false ? " (inaktiv, återaktivera den i stället?)" : ""}.` })
      card = { title: "Ny foodtrucker" }
      break
    }
    case "set_foodtruck_active": {
      const t = truckById.get(p.foodtruck_id)
      lines.push(`${t?.name ?? "Foodtrucken"} ${p.active ? "aktiveras och kan boka igen" : "inaktiveras: den kan inte boka, men konto och historik finns kvar och den kan aktiveras igen"}.`)
      const future = data.bookings.filter((b) => spaceId(b.foodtruck) === p.foodtruck_id)
      if (!p.active && future.length) lines.push(`Kommande bokningar ligger kvar: ${list(future.map((b) => `${b.space?.name ?? ""} ${svDate(b.start)}`))}`)
      card = { title: p.active ? "Aktivera foodtruck" : "Inaktivera foodtruck" }
      break
    }
    case "delete_foodtrucker": {
      const t = truckById.get(p.foodtruck_id)
      lines.push(`Tar bort ${t?.name ?? "foodtrucken"}${p.delete_user && t?.user ? ` och kontot ${t.user.email}` : ""}. Det går inte att ångra i appen.`)
      const future = data.bookings.filter((b) => spaceId(b.foodtruck) === p.foodtruck_id)
      if (future.length) warnings.push(warn("delete-with-bookings", list(future.map((b) => `${b.space?.name ?? ""} ${svDate(b.start)}`))))
      card = { title: "Ta bort foodtrucker", requireText: "bekräfta" }
      break
    }
  }
  return { ...card, lines, warnings, stopped: warnings.some((w) => w.severity === "stopp") }
}

function normalizeName(s: string | null | undefined): string {
  return String(s ?? "").toLowerCase().replace(/[^a-zåäö0-9]/g, "")
}

function matchesTemplate(slots: Slot[]): boolean {
  const key = (ss: readonly { start: string; end: string }[]) => ss.map((s) => `${hhmm(s.start)}-${hhmm(s.end)}`).join(",")
  return POLICY.slotTemplates.some((t) => key(t.slots) === key(slots))
}
