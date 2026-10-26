/**
 * Shared booking rules — the single source of truth for "is this slot blocked?"
 * and "is this date inside the space's season?". Used by the booking page, the
 * space details page, the available-slots dialog and createBooking() on the
 * server, so the UI can never disagree with what the server accepts.
 *
 * All dates are plain "yyyy-MM-dd" strings to avoid timezone shifts.
 */

export type SlotType = "morning" | "evening"

/** Morning = start hour before 16:00, evening = 16:00 or later. */
export function slotTypeFromHour(hour: number): SlotType {
  return hour < 16 ? "morning" : "evening"
}

/** Slot type from a time-slot start string like "10:00" or "16:00:00". */
export function slotTypeFromStart(start: string): SlotType {
  return slotTypeFromHour(parseInt(start.split(":")[0]))
}

/**
 * Find the block (if any) that covers a space + date + slot type.
 * A block matches when its time_slot is "all_day" or equals the slot type.
 */
export function findSlotBlock(
  blockedDates: any[],
  spaceId: string | number,
  dateStr: string,
  slotType: SlotType
): { blocked: boolean; reason?: string } {
  const block = blockedDates.find((b) => {
    if (b?.status === "archived") return false
    if (String(b?.space?.id ?? b?.space) !== String(spaceId)) return false
    if (b.date !== dateStr) return false
    return b.time_slot === "all_day" || b.time_slot === slotType
  })
  return block ? { blocked: true, reason: block.reason || undefined } : { blocked: false }
}

/** Dates on which a space is blocked for the whole day. */
export function allDayBlockedDates(blockedDates: any[], spaceId: string | number): string[] {
  return blockedDates
    .filter(
      (b) =>
        b?.status !== "archived" &&
        String(b?.space?.id ?? b?.space) === String(spaceId) &&
        b.time_slot === "all_day"
    )
    .map((b) => b.date)
}

/**
 * Whether a date falls outside a space's seasonal booking window
 * (bookable_from / bookable_to, either may be null = open-ended).
 */
export function seasonStatus(space: any, dateStr: string): { outside: boolean; label?: string } {
  const from = space?.bookable_from ? String(space.bookable_from).slice(0, 10) : null
  const to = space?.bookable_to ? String(space.bookable_to).slice(0, 10) : null
  if (!from && !to) return { outside: false }
  const outside = Boolean((from && dateStr < from) || (to && dateStr > to))
  if (!outside) return { outside: false }
  const sv = (x: string) => x.split("-").reverse().join("/") // yyyy-MM-dd → dd/MM/yyyy
  const label = from && to
    ? `Bokningsbar ${sv(from)}–${sv(to)}`
    : from ? `Bokningsbar från ${sv(from)}` : `Bokningsbar till ${sv(to!)}`
  return { outside: true, label }
}
