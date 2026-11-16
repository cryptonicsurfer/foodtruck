/**
 * Server-only data access for the public control page (/idag) and the cancellation log.
 *
 * Everything here uses the service account `foodtruck.public@falkenberg.se`
 * (PUBLIC_SCHEDULE_TOKEN): read on a few named fields of spaces, foodtrucks, bookings
 * and blocks, create + read on `foodtruck_cancelled_bookings`, nothing else. Created by
 * ops/directus/public-schedule-schema.sh. No owner names or e-mail can leave through
 * this account, because it cannot read them.
 *
 * Off unless PUBLIC_SCHEDULE_ENABLED=1 and the token is set: the page answers 404 and
 * cancellations are simply not logged.
 */
import { serverEnv } from "@/lib/env"
import { addDays, type RawBooking, type RawCancelled, type RawSpace } from "./public-schedule.ts"

export const CANCELLED = "foodtruck_cancelled_bookings"

function token(): string | null {
  return process.env.PUBLIC_SCHEDULE_TOKEN || null
}

export function publicScheduleEnabled(): boolean {
  return process.env.PUBLIC_SCHEDULE_ENABLED === "1" && Boolean(token())
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${serverEnv.DIRECTUS_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}`, ...(init.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new Error(`Directus svarade ${res.status} på ${path.split("?")[0]}`)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as { data: T }).data
}

export type DayData = {
  spaces: RawSpace[]
  bookings: RawBooking[]
  blocks: any[]
  /** null = the cancellation log could not be read (the page says so, never shows "none"). */
  cancelled: RawCancelled[] | null
}

// The page is open to anyone, so Directus is asked at most once per day-key per 20 s.
const TTL_MS = 20_000
const cache = new Map<string, { at: number; data: Promise<DayData> }>()

/** Raw rows for one day (plus the day before, for passes that run past midnight). */
export function loadDay(day: string): Promise<DayData> {
  const hit = cache.get(day)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data
  const data = fetchDay(day)
  cache.set(day, { at: Date.now(), data })
  data.catch(() => cache.delete(day)) // never cache a failure
  if (cache.size > 300) for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k)
  return data
}

async function fetchDay(day: string): Promise<DayData> {
  const range = encodeURIComponent(`${addDays(day, -1)}T00:00:00,${day}T23:59:59`)
  const truck = "foodtruck.id,foodtruck.name,foodtruck.image"
  const [spaces, bookings, blocks, cancelled] = await Promise.all([
    req<RawSpace[]>(`/items/spaces?fields=id,name,address,location,time_slots&limit=-1`),
    req<RawBooking[]>(`/items/foodtruck_bookings?filter[start][_between]=${range}&fields=id,start,end,date_created,space,${truck}&sort=start&limit=-1`),
    req<any[]>(`/items/space_blocked_dates?filter[date][_eq]=${day}&filter[status][_neq]=archived&fields=space,date,time_slot,status&limit=-1`),
    req<RawCancelled[]>(`/items/${CANCELLED}?filter[start][_between]=${range}&fields=id,start,end,booked_at,cancelled_at,space,${truck}&limit=-1`).catch((e) => {
      console.error("Publik sida: avbokningsloggen kunde inte läsas:", e)
      return null
    }),
  ])
  return { spaces, bookings, blocks, cancelled }
}

export type BookingSnapshot = { id: number | string; foodtruck: number | string; space: number | string; start: string; end: string; date_created?: string | null }

/**
 * Read a booking just before it is deleted, so the cancellation can be logged.
 * Returns null when the feature is off or the read fails — a cancellation must never
 * be stopped by the log.
 */
export async function snapshotBooking(id: string): Promise<BookingSnapshot | null> {
  if (!publicScheduleEnabled() || !/^\d+$/.test(String(id))) return null
  try {
    return await req<BookingSnapshot>(`/items/foodtruck_bookings/${id}?fields=id,foodtruck,space,start,end,date_created`)
  } catch (e) {
    console.error("Avbokningslogg: kunde inte läsa bokningen före avbokning:", e)
    return null
  }
}

/** Write the cancelled booking to the log. Never throws. */
export async function logCancellation(b: BookingSnapshot | null): Promise<void> {
  if (!b || !publicScheduleEnabled()) return
  try {
    await req(`/items/${CANCELLED}?fields=id`, {
      method: "POST",
      body: JSON.stringify({
        booking: Number(b.id),
        foodtruck: b.foodtruck,
        space: b.space,
        start: b.start,
        end: b.end,
        // foodtruck_bookings.date_created is a naive UTC timestamp
        booked_at: b.date_created ? (/[zZ]$/.test(b.date_created) ? b.date_created : `${b.date_created}Z`) : null,
        cancelled_at: new Date().toISOString(),
        source: "app",
      }),
    })
    cache.clear()
  } catch (e) {
    console.error(`Avbokningslogg: kunde inte logga avbokningen av bokning ${b.id}:`, e)
  }
}
