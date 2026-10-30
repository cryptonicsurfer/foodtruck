/**
 * POST /api/admin-assistant/confirm — run or cancel a proposal. Admin only (guard),
 * and only the user who got the card, only while it is pending and < 10 min old.
 * The change runs with the user's own token; the stored proposal is executed, never
 * anything from the request except the few fields the card lets the user edit.
 */
import { NextResponse } from "next/server"
import { revalidatePath, revalidateTag } from "next/cache"
import { guard } from "@/lib/assistant/guard"
import { getLogRow, claimRow, finishRow, logProposal, PROPOSAL_TTL_MS } from "@/lib/assistant/log"
import { analyzeImpact, type Proposal } from "@/lib/assistant/impact"
import { loadSnapshot } from "@/lib/assistant/tools"
import { executeProposal } from "@/lib/assistant/execute"
import { reverseGeocode } from "@/lib/assistant/geo"

export const dynamic = "force-dynamic"
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const json = (body: unknown, status = 200) => NextResponse.json(body, { status })

/** The fields a card lets the user edit. Everything else comes from the stored proposal. */
async function applyEdits(p: Proposal, edits: any): Promise<Proposal | string> {
  if (!edits || typeof edits !== "object") return p
  if (p.kind === "create_space") {
    const next = { ...p }
    if (typeof edits.name === "string" && edits.name.trim()) next.name = edits.name.trim().slice(0, 120)
    if (edits.lng !== undefined || edits.lat !== undefined) {
      const lng = Number(edits.lng), lat = Number(edits.lat)
      if (!(lng > 12.2 && lng < 12.9 && lat > 56.75 && lat < 57.15)) return "Punkten ligger utanför Falkenbergs kommun."
      if (lng !== p.lng || lat !== p.lat) {
        next.lng = lng
        next.lat = lat
        next.address = await reverseGeocode(lng, lat)
      }
    }
    return next
  }
  if (p.kind === "create_foodtrucker" && typeof edits.email === "string") {
    const email = edits.email.trim().toLowerCase()
    if (!EMAIL.test(email)) return "Ogiltig e-postadress."
    return { ...p, email }
  }
  return p
}

const sameWarnings = (a: { warnings: { text: string; detail?: string }[] }, b: typeof a) =>
  JSON.stringify(a.warnings.map((w) => [w.text, w.detail])) === JSON.stringify(b.warnings.map((w) => [w.text, w.detail]))

export async function POST(req: Request) {
  const g = await guard(req, "confirm")
  if (g instanceof NextResponse) return g

  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: "Felaktig förfrågan" }, 400)
  }
  const row = typeof body?.id === "string" ? await getLogRow(body.id) : null
  // Someone else's card looks exactly like a missing one
  if (!row || row.user !== g.userId) return json({ error: "Förslaget finns inte." }, 404)
  if (row.status !== "pending") return json({ error: "Förslaget är redan hanterat." }, 409)
  if (Date.now() - Date.parse(row.date_created) > PROPOSAL_TTL_MS) {
    if (await claimRow(row.id, "expired")) await finishRow(row.id, "expired", null)
    return json({ error: "Förslaget är äldre än 10 minuter. Be assistenten om ett nytt." }, 410)
  }

  if (body.action === "cancel") {
    await claimRow(row.id, "cancelled")
    return json({ ok: true, message: "Avbrutet. Inget ändrades." })
  }
  if (body.action !== "confirm") return json({ error: "Felaktig förfrågan" }, 400)

  const proposal = await applyEdits(row.proposal, body.edits)
  if (typeof proposal === "string") return json({ error: proposal }, 400)

  // Re-check against the data as it is NOW
  const data = await loadSnapshot(g.token)
  const card = analyzeImpact(proposal, data)
  if (card.stopped) {
    if (await claimRow(row.id, "failed")) await finishRow(row.id, "failed", { reason: "stopp", warnings: card.warnings })
    return json({ error: card.warnings.filter((w) => w.severity === "stopp").map((w) => w.text).join(" "), card }, 409)
  }
  if (card.requireText && body.typed !== card.requireText) {
    return json({ error: `Skriv "${card.requireText}" för att bekräfta.` }, 400)
  }
  if (!sameWarnings(card, row.card)) {
    // Something changed since the card was shown (a new booking, an edited pin): show the new card, run nothing
    if (!(await claimRow(row.id, "expired"))) return json({ error: "Förslaget är redan hanterat." }, 409)
    await finishRow(row.id, "expired", { reason: "ändrat läge" })
    const id = await logProposal({ user: g.userId, prompt: `${row.prompt} (nytt kort vid Bekräfta)`, proposal, card })
    return json({ changed: true, id, card, proposal, message: "Läget har ändrats sedan kortet visades. Kontrollera det nya kortet." })
  }

  if (!(await claimRow(row.id, "confirming"))) return json({ error: "Förslaget är redan hanterat." }, 409)
  try {
    const result = await executeProposal(proposal, g.token, data)
    await finishRow(row.id, result.ok ? "executed" : "failed", { ...result, ...(proposal !== row.proposal ? { proposal } : {}) })
    revalidatePath("/admin")
    revalidatePath("/booking")
    for (const tag of ["bookings", "blocked-dates", "foodtrucks", "booking-rules"]) revalidateTag(tag)
    return json({ ok: result.ok, message: result.message })
  } catch (e) {
    const message = (e as Error).message || "Något gick fel."
    await finishRow(row.id, "failed", { error: message }).catch(() => {})
    return json({ ok: false, message: `Det gick inte: ${message}` }, 500)
  }
}
