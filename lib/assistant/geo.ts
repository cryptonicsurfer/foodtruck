/**
 * Geocoding via OpenStreetMap Nominatim — server-side only.
 * Only a place phrase or coordinates are sent, never personal data. Follows the usage
 * policy: own User-Agent, at most one request per second, answers cached in memory.
 * Volume here is a handful of calls a week.
 */

const NOMINATIM = "https://nominatim.openstreetmap.org"
const USER_AGENT = "foodtruck.businessfalkenberg.se admin-assistent (businessfalkenberg@gmail.com)"
// Falkenbergs kommun, roughly: keeps "stortorget" from landing in Stockholm
const VIEWBOX = "12.25,57.10,12.85,56.78"

export type GeoHit = { lng: number; lat: number; label: string }

const cache = new Map<string, unknown>()
let last = 0

async function nominatim<T>(path: string): Promise<T | null> {
  if (cache.has(path)) return cache.get(path) as T
  const wait = last + 1100 - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
  try {
    const res = await fetch(`${NOMINATIM}${path}`, {
      headers: { "User-Agent": USER_AGENT, "Accept-Language": "sv" },
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as T
    cache.set(path, body)
    return body
  } catch {
    return null
  }
}

/** Phrase → up to 3 points inside Falkenberg municipality. */
export async function geocode(phrase: string): Promise<GeoHit[]> {
  const q = phrase.replace(/\b(platsen|vid|nära|bredvid|utanför)\b/gi, " ").replace(/\s+/g, " ").trim()
  if (!q) return []
  const query = /falkenberg/i.test(q) ? q : `${q}, Falkenberg`
  const rows = await nominatim<any[]>(
    `/search?format=jsonv2&limit=3&countrycodes=se&bounded=1&viewbox=${VIEWBOX}&q=${encodeURIComponent(query)}`
  )
  return (rows ?? []).map((r) => ({ lng: Number(r.lon), lat: Number(r.lat), label: shortLabel(r.address, r.display_name) }))
}

/** Coordinates → "Klittervägen, Skrea" style address, or null. */
export async function reverseGeocode(lng: number, lat: number): Promise<string | null> {
  const r = await nominatim<any>(`/reverse?format=jsonv2&zoom=17&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`)
  return r ? shortLabel(r.address, r.display_name) : null
}

function shortLabel(a: any, fallback: string): string {
  if (!a) return String(fallback ?? "").split(",").slice(0, 2).join(",").trim()
  const street = [a.road ?? a.pedestrian ?? a.square ?? a.footway, a.house_number].filter(Boolean).join(" ")
  const area = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.village ?? a.hamlet ?? a.town ?? a.city
  const name = a.amenity ?? a.leisure ?? a.tourism ?? a.shop
  return [name, street, area].filter(Boolean).join(", ") || String(fallback).split(",")[0]
}
