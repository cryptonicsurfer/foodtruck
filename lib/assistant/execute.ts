/**
 * Run a confirmed proposal — always with the USER's token, so Directus permissions
 * apply exactly as in /admin and Directus' activity log records who did it.
 * Re-checks the current state first; never trusts what was true when the card was made.
 */
import { directusServer } from "@/lib/directus-server"
import { serverEnv } from "@/lib/env"
import type { Proposal, Snapshot } from "./impact"

export type ExecResult = { ok: boolean; message: string; details?: unknown }

const sid = (x: any) => Number(x?.id ?? x)

export async function executeProposal(p: Proposal, token: string, data: Snapshot): Promise<ExecResult> {
  switch (p.kind) {
    case "block": {
      let created = 0, skipped = 0
      const failed: string[] = []
      for (const space of p.space_ids) {
        for (const date of p.dates) {
          const exists = data.blocks.some((b) => sid(b.space) === space && b.date === date && (b.time_slot === "all_day" || b.time_slot === p.time_slot))
          if (exists) { skipped++; continue }
          try {
            await directusServer.createSpaceBlockedDate({ space, date, time_slot: p.time_slot, ...(p.reason ? { reason: p.reason } : {}) }, token)
            created++
          } catch (e) {
            failed.push(`${space}/${date}: ${(e as Error).message}`)
          }
        }
      }
      return {
        ok: failed.length === 0,
        message: `${created} ${created === 1 ? "spärr skapad" : "spärrar skapade"}${skipped ? `, ${skipped} fanns redan` : ""}${failed.length ? `, ${failed.length} misslyckades` : ""}.`,
        details: { created, skipped, failed },
      }
    }
    case "unblock": {
      let removed = 0
      const failed: string[] = []
      for (const id of p.block_ids) {
        if (!data.blocks.some((b) => Number(b.id) === id)) continue
        try {
          await directusServer.deleteSpaceBlockedDate(String(id), token)
          removed++
        } catch (e) {
          failed.push(`${id}: ${(e as Error).message}`)
        }
      }
      return { ok: failed.length === 0, message: `${removed} ${removed === 1 ? "spärr borttagen" : "spärrar borttagna"}${failed.length ? `, ${failed.length} misslyckades` : ""}.`, details: { removed, failed } }
    }
    case "update_space": {
      await directusServer.updateSpace(String(p.space_id), p.changes, token)
      return { ok: true, message: "Platsen är uppdaterad." }
    }
    case "create_space": {
      const res = await directusServer.createSpace({
        name: p.name,
        description: p.description ?? null,
        location: { type: "Point", coordinates: [p.lng, p.lat] },
        time_slots: p.time_slots,
        bookable_from: p.bookable_from ?? null,
        bookable_to: p.bookable_to ?? null,
        address: p.address ?? null,
        aliases: p.aliases?.length ? p.aliases : null,
      }, token)
      return { ok: true, message: `Platsen ${p.name} är skapad.`, details: { id: res.data?.id } }
    }
    case "add_alias": {
      const space = data.spaces.find((s) => Number(s.id) === p.space_id)
      const aliases: string[] = space?.aliases ?? []
      if (aliases.some((a) => a.toLowerCase() === p.alias.toLowerCase())) return { ok: true, message: "Smeknamnet fanns redan." }
      await directusServer.updateSpace(String(p.space_id), { aliases: [...aliases, p.alias] }, token)
      return { ok: true, message: `"${p.alias}" är sparat som smeknamn.` }
    }
    case "update_rules": {
      await directusServer.updateBookingRules(p.changes, token)
      return { ok: true, message: "Bokningsreglerna är ändrade." }
    }
    case "create_foodtrucker": {
      const user = await directusServer.createFoodTruckUser({ email: p.email, first_name: p.first_name, last_name: p.last_name }, token)
      try {
        await directusServer.createFoodTruck({ name: p.foodtruck_name, ...(p.description ? { description: p.description } : {}), user: user.data.id }, token)
      } catch (e) {
        // Don't leave an account without a foodtruck behind
        await directusServer.deleteFoodTruckUser(user.data.id, token).catch(() => {})
        throw e
      }
      try {
        await directusServer.requestPasswordReset(p.email, `${serverEnv.APP_URL}/auth/password-reset`)
        return { ok: true, message: `${p.foodtruck_name} är skapad, och ${p.email} har fått ett mejl för att välja lösenord.` }
      } catch {
        return { ok: true, message: `${p.foodtruck_name} är skapad, men mejlet om lösenord gick inte iväg. Be ägaren använda "Glömt lösenordet?" på inloggningssidan.` }
      }
    }
    case "set_foodtruck_active": {
      await directusServer.setFoodTruckActive(String(p.foodtruck_id), p.active, token)
      return { ok: true, message: p.active ? "Foodtrucken är aktiverad." : "Foodtrucken är inaktiverad." }
    }
    case "delete_foodtrucker": {
      const truck = data.foodtrucks.find((t) => Number(t.id) === p.foodtruck_id)
      await directusServer.deleteFoodTruck(String(p.foodtruck_id), token)
      if (p.delete_user && truck?.user?.id) {
        try {
          await directusServer.deleteFoodTruckUser(truck.user.id, token)
        } catch {
          return { ok: true, message: "Foodtrucken är borttagen, men kontot kunde inte tas bort (det är kanske inte ett foodtrucker-konto)." }
        }
      }
      return { ok: true, message: `${truck?.name ?? "Foodtrucken"} är borttagen${p.delete_user ? " med konto" : ""}.` }
    }
  }
}
