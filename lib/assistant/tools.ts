/**
 * The admin assistant's tools. Read tools run directly with the user's token.
 * Propose tools never write anything but the log: they validate the arguments, build
 * a confirm card with analyzeImpact() and stop the turn. The change runs only when the
 * user presses Bekräfta (app/api/admin-assistant/confirm).
 */
import { directusServer } from "@/lib/directus-server"
import { analyzeImpact, expandDates, type Card, type Proposal, type Slot, type Snapshot } from "./impact"
import { matchSpaces, spacesNear } from "./match"
import { geocode, reverseGeocode } from "./geo"
import { logProposal } from "./log"
import type { ToolDef } from "./llm"
import { POLICY } from "@/lib/foodtruck-policy"

export type ToolContext = { token: string; userId: string; prompt: string }

/** Shown to the user under the chat; the model gets `forModel`. */
export type UiEvent =
  | { type: "proposal"; id: string; card: Card; proposal: Proposal }
  | { type: "space_choice"; question: string; candidates: SpaceCandidate[] }

export type ToolResult = { forModel: string; ui?: UiEvent; endsTurn?: boolean }

export type SpaceCandidate = {
  id: number
  name: string
  address: string | null
  aliases: string[]
  description: string | null
  lng?: number
  lat?: number
  pass: string
  season: string
  upcoming_bookings: number
  matched_on?: string
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

export function todayStockholm(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date())
}

export async function loadSnapshot(token: string): Promise<Snapshot> {
  const today = todayStockholm()
  const until = new Date(Date.now() + 550 * 864e5).toISOString()
  const [spaces, bookings, blocks, trucks, rules] = await Promise.all([
    directusServer.getAllSpaces(token),
    directusServer.getBookingsForDateRange(`${today}T00:00:00`, until, token),
    directusServer.getSpaceBlockedDates(token),
    directusServer.getAllFoodTrucksWithUsers(token),
    directusServer.getBookingRules(token).catch(() => ({ data: null })),
  ])
  return {
    today,
    spaces: spaces.data ?? [],
    bookings: bookings.data ?? [],
    blocks: blocks.data ?? [],
    foodtrucks: trucks.data ?? [],
    rules: (rules as any)?.data ?? null,
  }
}

const sid = (x: any) => Number(x?.id ?? x)
const hhmm = (t: string) => String(t ?? "").slice(0, 5)

function candidate(s: any, data: Snapshot, matched_on?: string): SpaceCandidate {
  const c = s.location?.coordinates
  return {
    id: Number(s.id),
    name: s.name,
    address: s.address ?? null,
    aliases: s.aliases ?? [],
    description: s.description ? String(s.description).slice(0, 160) : null,
    ...(c ? { lng: c[0], lat: c[1] } : {}),
    pass: (s.time_slots ?? []).map((t: Slot) => `${hhmm(t.start)}–${hhmm(t.end)}`).join(" + ") || "inga pass",
    season: s.bookable_from || s.bookable_to ? `${s.bookable_from ?? "…"}–${s.bookable_to ?? "…"}` : "hela året",
    upcoming_bookings: data.bookings.filter((b) => sid(b.space) === Number(s.id)).length,
    ...(matched_on ? { matched_on } : {}),
  }
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

const str = (description: string) => ({ type: "string", description })
const int = (description: string) => ({ type: "integer", description })
const date = (description: string) => ({ type: "string", description: `${description} (yyyy-MM-dd)` })
const slotsSchema = {
  type: "array",
  description: "Pass, t.ex. [{start:'10:00', end:'03:00'}]. Slut före start = över midnatt.",
  items: { type: "object", properties: { start: str("HH:MM"), end: str("HH:MM"), description: str("valfri") }, required: ["start", "end"] },
}
const fn = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): ToolDef => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } },
})

export const TOOLS: ToolDef[] = [
  fn("find_space", "Hitta platser utifrån en lös fras ('vid stortorget', 'sanddynevägen'). Söker namn, smeknamn, adress, beskrivning och geokodar frasen om inget träffar. Returnerar kandidater med metadata.", { query: str("frasen som användaren skrev") }, ["query"]),
  fn("ask_which_space", "Visa platskort så att användaren bekräftar vilken plats hen menar. Använd ALLTID innan du agerar på en plats som inte nämnts med exakt namn eller redan bekräftats. Avslutar din tur.", {
    question: str("kort fråga, t.ex. 'Menar du den här platsen?'"),
    space_ids: { type: "array", items: { type: "integer" }, description: "1–4 kandidater, bästa först" },
  }, ["question", "space_ids"]),
  fn("list_spaces", "Alla platser med pass, säsong, adress och smeknamn.", {}),
  fn("list_bookings", "Bokningar i ett datumintervall, valfritt för en plats.", { from: date("från"), to: date("till"), space_id: int("valfri plats") }, ["from", "to"]),
  fn("list_blocks", "Spärrar (med id) i ett datumintervall, valfritt för en plats.", { from: date("från"), to: date("till"), space_id: int("valfri plats") }, ["from", "to"]),
  fn("list_foodtrucks", "Foodtrucks med id, namn, aktiv/inaktiv, ägarens namn och antal kommande bokningar. Ingen e-post.", { query: str("valfri del av namnet") }),
  fn("get_rules", "Bokningsreglerna (max framtida bokningar, max dagar framåt, sista minuten).", {}),
  fn("geocode_place", "Slå upp en adress eller plats i Falkenberg (för nya platser). Returnerar punkter med adress och befintliga platser i närheten. Hitta aldrig på koordinater själv.", { phrase: str("adress eller platsbeskrivning") }, ["phrase"]),
  fn("propose_block", "Föreslå spärr av en eller flera platser för ett datum eller intervall. Skapar ett kort som användaren bekräftar. Avslutar din tur.", {
    space_ids: { type: "array", items: { type: "integer" } },
    from: date("första dagen"), to: date("sista dagen, samma som from för en dag"),
    time_slot: { type: "string", enum: ["all_day", "morning", "evening"], description: "all_day om inget annat sägs; morning = pass som börjar före 16, evening = 16 eller senare" },
    reason: str("orsak, kort"),
  }, ["space_ids", "from", "to", "time_slot"]),
  fn("propose_unblock", "Föreslå att spärrar tas bort (id från list_blocks). Avslutar din tur.", { block_ids: { type: "array", items: { type: "integer" } } }, ["block_ids"]),
  fn("propose_update_space", "Föreslå ändring av en plats: namn, beskrivning, pass eller säsong. Ange bara det som ändras. null för säsong = ingen gräns. Avslutar din tur.", {
    space_id: int("platsen"), name: str("nytt namn"), description: str("ny beskrivning"), time_slots: slotsSchema,
    bookable_from: { type: ["string", "null"], description: "säsongsstart yyyy-MM-dd eller null" },
    bookable_to: { type: ["string", "null"], description: "säsongsslut yyyy-MM-dd eller null" },
  }, ["space_id"]),
  fn("propose_create_space", "Föreslå en ny plats. Koordinater ska komma från geocode_place. Användaren kan flytta nålen på kortet. Avslutar din tur.", {
    name: str("namn, t.ex. 'Tullbron plats 1'"), lng: { type: "number" }, lat: { type: "number" },
    description: str("t.ex. el, vatten"), time_slots: slotsSchema,
    bookable_from: { type: ["string", "null"] }, bookable_to: { type: ["string", "null"] },
    aliases: { type: "array", items: { type: "string" }, description: "smeknamn användaren använde" },
  }, ["name", "lng", "lat"]),
  fn("propose_add_alias", "Föreslå att spara ett smeknamn för en plats, efter att användaren bekräftat vilken plats ett smeknamn betyder. Avslutar din tur.", { space_id: int("platsen"), alias: str("smeknamnet") }, ["space_id", "alias"]),
  fn("propose_update_rules", "Föreslå ändrade bokningsregler. Ange bara det som ändras. Avslutar din tur.", {
    maximum_future_bookings: int("max antal framtida bokningar per foodtruck"),
    maximum_days_ahead: int("max dagar framåt"),
    last_minute_booking_hours: int("timmar före start då sista-minuten gäller"),
  }),
  fn("propose_create_foodtrucker", "Föreslå ny foodtrucker: konto + foodtruck. Ägaren får mejl och väljer eget lösenord. Fråga aldrig efter lösenord. Avslutar din tur.", {
    first_name: str("förnamn"), last_name: str("efternamn"), email: str("e-post"), foodtruck_name: str("foodtruckens namn"), description: str("valfri beskrivning"),
  }, ["first_name", "last_name", "email", "foodtruck_name"]),
  fn("propose_set_foodtruck_active", "Föreslå att inaktivera (förstahandsval när någon 'ska bort') eller återaktivera en foodtruck. Avslutar din tur.", { foodtruck_id: int("foodtrucken"), active: { type: "boolean" } }, ["foodtruck_id", "active"]),
  fn("propose_delete_foodtrucker", "Föreslå borttagning av foodtruck och konto. Bara när användaren uttryckligen vill ta bort, inte inaktivera. Avslutar din tur.", { foodtruck_id: int("foodtrucken"), delete_user: { type: "boolean", description: "ta bort kontot också" } }, ["foodtruck_id", "delete_user"]),
]

// ---------------------------------------------------------------------------
// Validation helpers (the model's arguments are untrusted input)
// ---------------------------------------------------------------------------

class ArgError extends Error {}
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function reqStr(v: unknown, name: string, max = 200): string {
  if (typeof v !== "string" || !v.trim()) throw new ArgError(`${name} saknas`)
  if (v.length > max) throw new ArgError(`${name} är för lång`)
  return v.trim()
}
function optStr(v: unknown, name: string, max = 1000): string | undefined {
  return v === undefined || v === null || v === "" ? undefined : reqStr(v, name, max)
}
function reqDate(v: unknown, name: string): string {
  if (typeof v !== "string" || !DATE.test(v) || isNaN(Date.parse(v))) throw new ArgError(`${name} ska vara yyyy-MM-dd`)
  return v
}
function optNullableDate(v: unknown, name: string): string | null | undefined {
  return v === undefined ? undefined : v === null || v === "" ? null : reqDate(v, name)
}
function reqInt(v: unknown, name: string): number {
  const n = typeof v === "string" ? Number(v) : v
  if (typeof n !== "number" || !Number.isInteger(n)) throw new ArgError(`${name} ska vara ett heltal`)
  return n
}
function intList(v: unknown, name: string, max = 50): number[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) throw new ArgError(`${name}: 1–${max} id`)
  return [...new Set(v.map((x) => reqInt(x, name)))]
}
function slotList(v: unknown): Slot[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 6) throw new ArgError("time_slots: 1–6 pass")
  return v.map((s: any) => {
    const start = hhmm(s?.start), end = hhmm(s?.end)
    if (!TIME.test(start) || !TIME.test(end)) throw new ArgError("pass ska vara HH:MM")
    return { start, end, ...(s?.description ? { description: String(s.description).slice(0, 80) } : {}) }
  })
}
function knownSpace(data: Snapshot, id: number): any {
  const s = data.spaces.find((x) => Number(x.id) === id)
  if (!s) throw new ArgError(`plats ${id} finns inte`)
  return s
}
function knownTruck(data: Snapshot, id: number): any {
  const t = data.foodtrucks.find((x) => Number(x.id) === id)
  if (!t) throw new ArgError(`foodtruck ${id} finns inte`)
  return t
}

/** Turn propose_* arguments into a validated Proposal. Throws ArgError with a message for the model. */
export function buildProposal(name: string, a: any, data: Snapshot): Proposal {
  switch (name) {
    case "propose_block": {
      const space_ids = intList(a.space_ids, "space_ids", 20)
      space_ids.forEach((id) => knownSpace(data, id))
      const from = reqDate(a.from, "from"), to = reqDate(a.to ?? a.from, "to")
      if (to < from) throw new ArgError("to är före from")
      const dates = expandDates(from, to)
      if (dates.length > 366) throw new ArgError("högst ett år åt gången")
      if (!["all_day", "morning", "evening"].includes(a.time_slot)) throw new ArgError("time_slot ska vara all_day, morning eller evening")
      return { kind: "block", space_ids, dates, time_slot: a.time_slot, reason: optStr(a.reason, "reason", 200) }
    }
    case "propose_unblock": {
      const block_ids = intList(a.block_ids, "block_ids", 400)
      if (!block_ids.some((id) => data.blocks.some((b) => Number(b.id) === id))) throw new ArgError("inga av spärrarna finns")
      return { kind: "unblock", block_ids }
    }
    case "propose_update_space": {
      const space_id = reqInt(a.space_id, "space_id")
      knownSpace(data, space_id)
      const changes: Extract<Proposal, { kind: "update_space" }>["changes"] = {}
      if (a.name !== undefined) changes.name = reqStr(a.name, "name", 120)
      if (a.description !== undefined) changes.description = optStr(a.description, "description") ?? null
      if (a.time_slots !== undefined) changes.time_slots = slotList(a.time_slots)
      if (a.bookable_from !== undefined) changes.bookable_from = optNullableDate(a.bookable_from, "bookable_from")
      if (a.bookable_to !== undefined) changes.bookable_to = optNullableDate(a.bookable_to, "bookable_to")
      if (Object.keys(changes).length === 0) throw new ArgError("inget att ändra")
      return { kind: "update_space", space_id, changes }
    }
    case "propose_create_space": {
      const lng = Number(a.lng), lat = Number(a.lat)
      // Falkenbergs kommun — a point outside is a made-up or wrong coordinate
      if (!(lng > 12.2 && lng < 12.9 && lat > 56.75 && lat < 57.15)) throw new ArgError("punkten ligger utanför Falkenbergs kommun; använd geocode_place")
      const name = reqStr(a.name, "name", 120)
      if (data.spaces.some((s) => String(s.name).toLowerCase() === name.toLowerCase())) throw new ArgError(`det finns redan en plats som heter ${name}`)
      return {
        kind: "create_space", name, lng, lat,
        description: optStr(a.description, "description") ?? null,
        time_slots: a.time_slots ? slotList(a.time_slots) : POLICY.slotTemplates[0].slots.map((s) => ({ ...s })),
        bookable_from: optNullableDate(a.bookable_from, "bookable_from") ?? null,
        bookable_to: optNullableDate(a.bookable_to, "bookable_to") ?? null,
        aliases: Array.isArray(a.aliases) ? a.aliases.slice(0, 5).map((x: unknown) => reqStr(x, "alias", 60)) : [],
      }
    }
    case "propose_add_alias": {
      const space_id = reqInt(a.space_id, "space_id")
      knownSpace(data, space_id)
      return { kind: "add_alias", space_id, alias: reqStr(a.alias, "alias", 60) }
    }
    case "propose_update_rules": {
      const changes: Record<string, number> = {}
      for (const k of ["maximum_future_bookings", "maximum_days_ahead", "last_minute_booking_hours"]) {
        if (a[k] !== undefined) {
          const n = reqInt(a[k], k)
          if (n < 0 || n > 1000) throw new ArgError(`${k} ska vara 0–1000`)
          changes[k] = n
        }
      }
      if (Object.keys(changes).length === 0) throw new ArgError("inget att ändra")
      return { kind: "update_rules", changes }
    }
    case "propose_create_foodtrucker": {
      const email = reqStr(a.email, "email", 200).toLowerCase()
      if (!EMAIL.test(email)) throw new ArgError("ogiltig e-postadress")
      return {
        kind: "create_foodtrucker", email,
        first_name: reqStr(a.first_name, "first_name", 80), last_name: reqStr(a.last_name, "last_name", 80),
        foodtruck_name: reqStr(a.foodtruck_name, "foodtruck_name", 120), description: optStr(a.description, "description") ?? null,
      }
    }
    case "propose_set_foodtruck_active": {
      const foodtruck_id = reqInt(a.foodtruck_id, "foodtruck_id")
      knownTruck(data, foodtruck_id)
      if (typeof a.active !== "boolean") throw new ArgError("active ska vara true/false")
      return { kind: "set_foodtruck_active", foodtruck_id, active: a.active }
    }
    case "propose_delete_foodtrucker": {
      const foodtruck_id = reqInt(a.foodtruck_id, "foodtruck_id")
      knownTruck(data, foodtruck_id)
      return { kind: "delete_foodtrucker", foodtruck_id, delete_user: a.delete_user !== false }
    }
  }
  throw new ArgError(`okänt verktyg ${name}`)
}

// ---------------------------------------------------------------------------
// Execution of one tool call
// ---------------------------------------------------------------------------

const json = (x: unknown) => {
  const s = JSON.stringify(x)
  return s.length > 12000 ? `${s.slice(0, 12000)}… (avkortat, smalna av frågan)` : s
}

export async function runTool(name: string, rawArgs: string, ctx: ToolContext, getData: () => Promise<Snapshot>): Promise<ToolResult> {
  let a: any
  try {
    a = rawArgs ? JSON.parse(rawArgs) : {}
  } catch {
    return { forModel: "Fel: argumenten är inte giltig JSON." }
  }
  try {
    const data = await getData()
    switch (name) {
      case "find_space": {
        const query = reqStr(a.query, "query", 200)
        const hits = matchSpaces(query, data.spaces).map((m) => candidate(m.space, data, m.why))
        if (hits.length && matchSpaces(query, data.spaces)[0].score >= 0.75) return { forModel: json({ candidates: hits }) }
        // Weak text match: geocode the phrase and look for spaces near it
        const points = await geocode(query)
        const near = points.flatMap((p) => spacesNear([p.lng, p.lat], data.spaces, 500).map((n) => ({ ...candidate(n.space, data, `${n.meters} m från ${p.label}`) })))
        const seen = new Set<number>()
        const all = [...hits, ...near].filter((c) => !seen.has(c.id) && seen.add(c.id)).slice(0, 5)
        return { forModel: json({ candidates: all, geocoded: points.map((p) => p.label), note: all.length ? undefined : "Ingen plats hittades. Fråga användaren eller visa list_spaces." }) }
      }
      case "ask_which_space": {
        const ids = intList(a.space_ids, "space_ids", 4)
        const candidates = ids.map((id) => candidate(knownSpace(data, id), data))
        return {
          forModel: "Platskortet visas. Vänta på användarens svar.",
          ui: { type: "space_choice", question: reqStr(a.question, "question", 200), candidates },
          endsTurn: true,
        }
      }
      case "list_spaces":
        return { forModel: json(data.spaces.map((s) => candidate(s, data))) }
      case "list_bookings":
      case "list_blocks": {
        const from = reqDate(a.from, "from"), to = reqDate(a.to, "to")
        const space = a.space_id !== undefined ? reqInt(a.space_id, "space_id") : undefined
        if (name === "list_bookings") {
          // Snapshot holds today → +18 months; past bookings aren't needed for admin work
          const rows = data.bookings
            .filter((b) => b.start.slice(0, 10) >= from && b.start.slice(0, 10) <= to && (space === undefined || sid(b.space) === space))
            .map((b) => ({ id: b.id, date: b.start.slice(0, 10), time: `${hhmm(b.start.slice(11))}–${hhmm(String(b.end ?? "").slice(11))}`, space: b.space?.name, space_id: sid(b.space), foodtruck: b.foodtruck?.name, foodtruck_id: sid(b.foodtruck) }))
          return { forModel: json({ from: data.today > from ? data.today : from, to, bookings: rows }) }
        }
        const rows = data.blocks
          .filter((b) => b.date >= from && b.date <= to && (space === undefined || sid(b.space) === space))
          .map((b) => ({ id: b.id, date: b.date, time_slot: b.time_slot, space: b.space?.name, space_id: sid(b.space), reason: b.reason ?? null }))
        return { forModel: json({ blocks: rows }) }
      }
      case "list_foodtrucks": {
        const q = typeof a.query === "string" ? a.query.toLowerCase() : ""
        const rows = data.foodtrucks
          .filter((t) => !q || String(t.name).toLowerCase().includes(q))
          .map((t) => ({
            id: t.id, name: t.name, active: t.active !== false,
            owner: [t.user?.first_name, t.user?.last_name].filter(Boolean).join(" ") || null,
            upcoming_bookings: data.bookings.filter((b) => sid(b.foodtruck) === Number(t.id)).length,
          }))
        return { forModel: json(rows) }
      }
      case "get_rules":
        return { forModel: json(data.rules) }
      case "geocode_place": {
        const points = await geocode(reqStr(a.phrase, "phrase", 200))
        const out = await Promise.all(points.map(async (p) => ({
          lng: p.lng, lat: p.lat, label: p.label,
          address: (await reverseGeocode(p.lng, p.lat)) ?? p.label,
          spaces_nearby: spacesNear([p.lng, p.lat], data.spaces, 300).map((n) => `${n.space.name} (${n.meters} m)`),
        })))
        return { forModel: json(out.length ? out : { note: "Hittade inget. Be användaren om en adress eller att peka på kartan." }) }
      }
    }
    if (name.startsWith("propose_")) {
      const proposal = buildProposal(name, a, data)
      if (proposal.kind === "create_space") proposal.address = await reverseGeocode(proposal.lng, proposal.lat)
      const card = analyzeImpact(proposal, data)
      const id = await logProposal({ user: ctx.userId, prompt: ctx.prompt, proposal, card })
      const summary = card.stopped
        ? `Kortet visas men kan inte bekräftas: ${card.warnings.filter((w) => w.severity === "stopp").map((w) => w.text).join(" ")}`
        : `Kortet visas för användaren${card.warnings.length ? ` med ${card.warnings.length} varning(ar)` : ""}. Vänta på Bekräfta/Avbryt.`
      return { forModel: summary, ui: { type: "proposal", id, card, proposal }, endsTurn: true }
    }
    return { forModel: `Fel: okänt verktyg ${name}.` }
  } catch (err) {
    if (err instanceof ArgError) return { forModel: `Fel i argumenten: ${err.message}` }
    console.error(`[assistant] ${name} misslyckades:`, (err as Error).message)
    return { forModel: `Fel: ${name} misslyckades (${(err as Error).message}). Säg det till användaren.` }
  }
}

