/**
 * POST /api/admin-assistant/confirm — run or cancel a proposal. Admin only (guard),
 * and only the user who got the card, only while it is pending and < 10 min old.
 * The change runs with the user's own token; the stored proposal is executed, never
 * anything from the request except the few fields the card lets the user edit.
 */
import { NextResponse } from "next/server"
import { revalidatePath, revalidateTag } from "next/cache"
import { guard } from "@/lib/assistant/guard"
import { getLogRow, claimRow, finishRow, logProposal, withRowLock, PROPOSAL_TTL_MS } from "@/lib/assistant/log"
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
  if (typeof body?.id !== "string") return json({ error: "Förslaget finns inte." }, 404)
  // Everything from reading the row to writing the result runs under the row's lock
  // handle() catches everything after execution starts, so an error escaping it means nothing ran
  const out = await withRowLock(body.id, () => handle(body, g.token, g.userId)).catch((e) => {
    console.error("[assistant] confirm failed before execution:", (e as Error).message)
    return json({ error: "Något gick fel innan ändringen kördes. Inget ändrades. Prova igen." }, 503)
  })
  return out === "busy" ? json({ error: "Förslaget hanteras redan." }, 409) : out
}

async function handle(body: any, token: string, userId: string): Promise<NextResponse> {
  const row = await getLogRow(body.id)
  // Someone else's card looks exactly like a missing one
  if (!row || row.user !== userId) return json({ error: "Förslaget finns inte." }, 404)
  if (row.status !== "pending") return json({ error: "Förslaget är redan hanterat." }, 409)
  if (Date.now() - Date.parse(row.date_created) > PROPOSAL_TTL_MS) {
    if (await claimRow(row.id, "expired")) await finishRow(row.id, "expired", null).catch(() => {})
    return json({ error: "Förslaget är äldre än 10 minuter. Be assistenten om ett nytt." }, 410)
  }

  if (body.action === "cancel") {
    await claimRow(row.id, "cancelled")
    return json({ ok: true, message: "Avbrutet. Inget ändrades." })
  }
  if (body.action !== "confirm") return json({ error: "Felaktig förfrågan" }, 400)

  const proposal = await applyEdits(row.proposal, body.edits)
  if (typeof proposal === "string") return json({ error: proposal }, 400)

  // Re-check against the data as it is NOW. A failure here ran nothing: the card stays open.
  let data: Awaited<ReturnType<typeof loadSnapshot>>
  let card: ReturnType<typeof analyzeImpact>
  try {
    data = await loadSnapshot(token)
    card = analyzeImpact(proposal, data)
  } catch (e) {
    console.error("[assistant] re-check failed:", (e as Error).message)
    return json({ error: "Kunde inte kontrollera läget just nu. Inget ändrades. Prova igen om en stund." }, 503)
  }
  if (card.stopped) {
    if (await claimRow(row.id, "failed")) await finishRow(row.id, "failed", { reason: "stopp", warnings: card.warnings }).catch(() => {})
    return json({ error: card.warnings.filter((w) => w.severity === "stopp").map((w) => w.text).join(" "), card }, 409)
  }
  if (card.requireText && body.typed !== card.requireText) {
    return json({ error: `Skriv "${card.requireText}" för att bekräfta.` }, 400)
  }
  if (!sameWarnings(card, row.card)) {
    // Something changed since the card was shown (a new booking, an edited pin): show the new card, run nothing
    if (!(await claimRow(row.id, "expired"))) return json({ error: "Förslaget är redan hanterat." }, 409)
    await finishRow(row.id, "expired", { reason: "ändrat läge" }).catch(() => {})
    const id = await logProposal({ user: userId, prompt: `${row.prompt} (nytt kort vid Bekräfta)`, proposal, card })
    return json({ changed: true, id, card, proposal, message: "Läget har ändrats sedan kortet visades. Kontrollera det nya kortet." })
  }

  if (!(await claimRow(row.id, "confirming"))) return json({ error: "Förslaget är redan hanterat." }, 409)
  let result: Awaited<ReturnType<typeof executeProposal>>
  try {
    result = await executeProposal(proposal, token, data)
  } catch (e) {
    const message = (e as Error).message || "Något gick fel."
    await finishRow(row.id, "failed", { error: message }).catch(() => {})
    return json({ ok: false, message: `Det gick inte: ${message}` }, 500)
  }
  // The change is done: a failing log write must not turn it into an error (the user
  // would retry and do it twice). The row then stays "confirming", which can't run again.
  await finishRow(row.id, result.ok ? "executed" : "failed", { ...result, ...(proposal !== row.proposal ? { proposal } : {}) })
    .catch((e) => console.error("[assistant] log write after execution failed:", (e as Error).message))
  revalidatePath("/admin")
  revalidatePath("/booking")
  for (const tag of ["bookings", "blocked-dates", "foodtrucks", "booking-rules"]) revalidateTag(tag)
  return json({ ok: result.ok, message: result.message, changed_data: proposal.kind })
}
