/**
 * The public control page (/idag): which foodtruck is booked where, per day — and which
 * bookings were cancelled, and when. Pure functions only (no fetch, no env), so the
 * page can never disagree with the tests.
 *
 * Booking `start`/`end` are raw Swedish wall-clock strings ("2026-11-06T10:00:00"), as
 * everywhere else in the app: compared as strings, never through `new Date()`.
 * `cancelled_at`/`booked_at` are real instants (ISO with offset).
 */
import { hhmmOf, shortTimeRange, findSlotBlock, slotTypeFromStart } from "./booking-rules.ts"

const TZ = "Europe/Stockholm"

export type RawSpace = {
  id: number | string
  name: string
  address?: string | null
  location?: { coordinates?: [number, number] } | null
  time_slots?: Array<{ start: string; end: string }> | null
}
type Ref = { id?: number | string; name?: string | null; image?: string | null } | number | string | null
export type RawBooking = { id: number | string; start: string; end: string; date_created?: string | null; space: Ref; foodtruck: Ref }
export type RawCancelled = {
  id: number | string
  start: string
  end?: string | null
  booked_at?: string | null
  cancelled_at: string
  space: Ref
  foodtruck: Ref
  /** Name at the time of cancellation — survives if the foodtruck is deleted later. */
  foodtruck_name?: string | null
}

export type DayBooking = {
  id: string
  truck: string
  truckId: string
  image: string | null
  time: string
  /** "now" = the pass is running, "later" = starts later the chosen day, "done" = over. */
  state: "now" | "later" | "done"
  /** Started the day before and runs past midnight (10–03). */
  sinceYesterday: boolean
  bookedAt: string | null
}
export type DayCancelled = {
  id: string
  truck: string
  truckId: string
  time: string
  cancelledAt: string
  bookedAt: string | null
  /** The pass started the day before and would still have been running now. */
  sinceYesterday: boolean
  /** Cancelled less than 24 h before the pass started (or after it started). */
  late: boolean
}
export type DaySpace = {
  id: string
  name: string
  address: string | null
  lat: number | null
  lng: number | null
  slots: string
  blocked: boolean
  bookings: DayBooking[]
  cancelled: DayCancelled[]
}

const idOf = (r: Ref): string => String(r && typeof r === "object" ? r.id ?? "" : r ?? "")
const nameOf = (r: Ref): string => (r && typeof r === "object" && r.name) || "Okänd foodtruck"
const imageOf = (r: Ref): string | null => (r && typeof r === "object" && r.image) || null

/** An instant → Swedish wall clock, "2026-11-06T10:00:00". */
export function stockholmLocal(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(at).map((x) => [x.type, x.value])
  )
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`
}

/** Add days to a "yyyy-MM-dd" string. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** The day to show: a valid `?d=` within [today − back, today + ahead], else today. */
export const DAYS_BACK = 120
export const DAYS_AHEAD = 60
export function pickDay(param: string | undefined, today: string, back = DAYS_BACK, ahead = DAYS_AHEAD): string {
  if (!param || !/^\d{4}-\d{2}-\d{2}$/.test(param)) return today
  // "2026-11-31" parses (as 1 Dec) instead of failing, so require a round trip
  const parsed = new Date(`${param}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== param) return today
  if (param < addDays(today, -back) || param > addDays(today, ahead)) return today
  return param
}

/** "fredag 6 november" */
export function longDay(day: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(
    new Date(`${day}T12:00:00Z`)
  )
}

/** An instant → "6 nov. 14:32" in Swedish time; a naive Directus timestamp is read as UTC. */
export function stamp(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(withZone(iso))
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d)
}

/** A Directus timestamp with an explicit zone; a naive one is UTC. */
export function withZone(iso: string): string {
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`
}

function instant(iso: string): number {
  return new Date(withZone(iso)).getTime()
}

/** Was the booking cancelled less than 24 h before its start (Swedish wall clock)? */
export function cancelledLate(start: string, cancelledAt: string): boolean {
  const cancelledLocal = stockholmLocal(new Date(instant(cancelledAt)))
  // Both are wall-clock strings now; reading them as UTC gives the right difference
  // except across a DST switch (an hour off, twice a year — fine for a 24 h flag).
  return new Date(`${start.slice(0, 19)}Z`).getTime() - new Date(`${cancelledLocal}Z`).getTime() < 24 * 3600 * 1000
}

/**
 * Everything the page shows for one day. `nowLocal` is the Swedish wall clock now.
 * A pass that started the day before and runs past midnight is shown only while it is
 * still running (today, before its end) — otherwise every day would repeat yesterday.
 */
export function buildDay(
  day: string,
  nowLocal: string,
  spaces: RawSpace[],
  bookings: RawBooking[],
  cancelled: RawCancelled[],
  blocks: any[] = []
): DaySpace[] {
  const today = nowLocal.slice(0, 10)
  const yesterday = addDays(day, -1)
  // A pass that started yesterday and runs past midnight belongs to "today" until it ends.
  // The same rule for bookings and for cancellations: at 01:00 an officer must see both.
  const onDay = (x: { start: string; end?: string | null }) =>
    x.start.slice(0, 10) === day || (day === today && x.start.slice(0, 10) === yesterday && Boolean(x.end) && x.end! > nowLocal)

  return spaces
    .map((s) => {
      const sid = String(s.id)
      const c = s.location?.coordinates
      const mine = bookings
        // A booking whose foodtruck has been deleted (FK is SET NULL) entitles nobody:
        // it is left out rather than shown as "Okänd foodtruck · Bokad".
        .filter((b) => idOf(b.space) === sid && idOf(b.foodtruck) !== "")
        .filter(onDay)
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((b): DayBooking => ({
          id: String(b.id),
          truck: nameOf(b.foodtruck),
          truckId: idOf(b.foodtruck),
          image: imageOf(b.foodtruck),
          time: shortTimeRange(b.start, b.end),
          state: b.end <= nowLocal ? "done" : b.start <= nowLocal ? "now" : "later",
          sinceYesterday: b.start.slice(0, 10) !== day,
          bookedAt: stamp(b.date_created),
        }))
      const gone = cancelled
        .filter((x) => idOf(x.space) === sid && onDay(x))
        .sort((a, b) => instant(b.cancelled_at) - instant(a.cancelled_at))
        .map((x): DayCancelled => ({
          id: String(x.id),
          truck: x.foodtruck_name || nameOf(x.foodtruck),
          // a deleted foodtruck has no id left: keep such rows apart by name
          truckId: idOf(x.foodtruck) || `namn:${x.foodtruck_name ?? x.id}`,
          time: shortTimeRange(x.start, x.end),
          sinceYesterday: x.start.slice(0, 10) !== day,
          cancelledAt: stamp(x.cancelled_at) ?? "okänd tid",
          bookedAt: stamp(x.booked_at),
          late: cancelledLate(x.start, x.cancelled_at),
        }))
      const slots = s.time_slots ?? []
      return {
        id: sid,
        name: s.name,
        address: s.address?.trim() || null,
        lat: c ? c[1] : null,
        lng: c ? c[0] : null,
        slots: slots.map((t) => shortTimeRange(t.start, t.end)).join(", "),
        // Blocked = every pass of the space is covered by a block that day.
        blocked: slots.length > 0 && slots.every((t) => findSlotBlock(blocks, sid, day, slotTypeFromStart(hhmmOf(t.start))).blocked),
        bookings: mine,
        cancelled: gone,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
}

export type TruckDay = { truckId: string; truck: string; booked: { space: string; time: string; state: DayBooking["state"] }[]; cancelled: { space: string; time: string; cancelledAt: string }[] }

/** The same day turned around: per foodtruck, where it is booked and what it cancelled. */
export function byTruck(spaces: DaySpace[]): TruckDay[] {
  const m = new Map<string, TruckDay>()
  const get = (id: string, name: string) => {
    if (!m.has(id)) m.set(id, { truckId: id, truck: name, booked: [], cancelled: [] })
    return m.get(id)!
  }
  for (const s of spaces) {
    for (const b of s.bookings) get(b.truckId, b.truck).booked.push({ space: s.name, time: b.time, state: b.state })
    for (const x of s.cancelled) get(x.truckId, x.truck).cancelled.push({ space: s.name, time: x.time, cancelledAt: x.cancelledAt })
  }
  return [...m.values()].sort((a, b) => a.truck.localeCompare(b.truck, "sv"))
}

/** Metres between two points (haversine). */
export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (x: number) => (x * Math.PI) / 180
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}
