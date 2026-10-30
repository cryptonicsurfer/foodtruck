/**
 * Find spaces from a loose phrase ("platsen vid sanddynevägen", "vid stortorget").
 * Pure functions — no network — so the matching is testable. Geocoding of the phrase
 * (lib/assistant/geo.ts) is a second step when the text match is weak.
 */

export type SpaceLike = {
  id: number | string
  name: string
  description?: string | null
  address?: string | null
  aliases?: string[] | null
  location?: { type?: string; coordinates?: [number, number] } | null
}

// Words that say nothing about which space is meant
const STOP = new Set([
  "platsen", "plats", "platserna", "vid", "på", "i", "nära", "bredvid", "den", "det", "som",
  "ligger", "utanför", "vi", "har", "och", "mot", "till", "en", "ett", "the", "vår", "gamla",
])

/** Lowercase, fold å/ä/ö/é and drop punctuation, so "Rådhustorget" ≈ "radhustorget". */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function words(s: string): string[] {
  return normalize(s).split(" ").filter((w) => w.length > 1 && !STOP.has(w))
}

function trigrams(s: string): Set<string> {
  const t = `  ${s} `
  const out = new Set<string>()
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3))
  return out
}

/** Trigram similarity 0..1 (Dice). Catches "sanddynevägen" vs "sanddynevagen", typos. */
export function similarity(a: string, b: string): number {
  const A = trigrams(normalize(a)), B = trigrams(normalize(b))
  if (A.size === 0 || B.size === 0) return 0
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return (2 * hit) / (A.size + B.size)
}

/** Best similarity between any query word and any word of the text (compound-friendly). */
function bestWordScore(qWords: string[], text: string | null | undefined): number {
  if (!text) return 0
  const tWords = words(text)
  let best = 0
  for (const q of qWords) {
    for (const t of tWords) {
      if (t === q) best = Math.max(best, 1)
      else if (q.length >= 4 && (t.startsWith(q) || t.includes(q))) best = Math.max(best, 0.9)
      else best = Math.max(best, similarity(q, t))
    }
  }
  return best
}

/** A single letter or number in the query ("plats E", "5") that should match the name. */
function designators(query: string): string[] {
  return normalize(query).split(" ").filter((w) => /^([a-z]|\d{1,2})$/.test(w))
}

export type SpaceMatch<S extends SpaceLike> = { space: S; score: number; why: string }

/**
 * Score every space against the phrase. Aliases count most (they are what the
 * colleagues actually say), then name, address, description.
 */
export function matchSpaces<S extends SpaceLike>(query: string, spaces: S[], limit = 5): SpaceMatch<S>[] {
  const q = words(query)
  const marks = designators(query)
  if (q.length === 0 && marks.length === 0) return []
  const scored = spaces.map((space) => {
    const alias = Math.max(0, ...(space.aliases ?? []).map((a) => (normalize(a) === normalize(query) ? 1.2 : bestWordScore(q, a))))
    const name = bestWordScore(q, space.name)
    const address = bestWordScore(q, space.address) * 0.9
    const desc = bestWordScore(q, space.description) * 0.6
    let score = Math.max(alias, name, address, desc)
    let why = score === alias && alias > 0 ? "alias" : score === name ? "namn" : score === address ? "adress" : "beskrivning"
    // "Klittervägen E": the letter decides between C, D and E
    const nameMarks = normalize(space.name).split(" ")
    if (marks.length > 0) {
      if (marks.some((m) => nameMarks.includes(m))) score += 0.3
      else if (q.length > 0) score -= 0.15
      if (q.length === 0) why = "namn"
    }
    return { space, score, why }
  })
  return scored
    .filter((m) => m.score >= 0.45)
    .sort((a, b) => b.score - a.score || String(a.space.name).localeCompare(String(b.space.name), "sv"))
    .slice(0, limit)
}

/** Meters between two [lng, lat] points. */
export function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b[1] - a[1]), dLng = rad(b[0] - a[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Spaces within `radius` meters of a point, nearest first. */
export function spacesNear<S extends SpaceLike>(point: [number, number], spaces: S[], radius = 400): { space: S; meters: number }[] {
  return spaces
    .filter((s) => s.location?.coordinates)
    .map((s) => ({ space: s, meters: Math.round(distanceMeters(point, s.location!.coordinates!)) }))
    .filter((x) => x.meters <= radius)
    .sort((a, b) => a.meters - b.meters)
}
