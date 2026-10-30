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

// ---------------------------------------------------------------------------
// Impact checks — what a block or a time-slot change would actually hit.
// Used by the admin dialogs so an admin sees conflicts before saving (and later
// by the admin assistant's confirm cards, specs/admin-assistent.md).
// Bookings are { start, end?, space, foodtruck } with raw "yyyy-MM-ddTHH:mm:ss" strings.
// ---------------------------------------------------------------------------

type Slot = { start: string; end: string; description?: string }
export type BlockSlot = SlotType | "all_day"

/** "10:00:00", "2026-11-06T10:00:00" → "10:00". */
export function hhmmOf(t: string): string {
  const time = t.includes("T") ? t.slice(11) : t
  return time.slice(0, 5)
}

/** "10:00"–"03:00" → "10–03"; keeps minutes when they aren't :00 ("15:30–22"). */
export function shortTimeRange(start: string, end?: string | null): string {
  const s = (t: string) => (hhmmOf(t).endsWith(":00") ? hhmmOf(t).slice(0, 2) : hhmmOf(t))
  return end ? `${s(start)}–${s(end)}` : s(start)
}

/**
 * What kind of pass a slot is, for icons: morning (ends by 16), evening (starts at 16+),
 * or full (starts before 16 and runs past it, e.g. 10:00–03:00).
 */
export function slotKind(start: string, end?: string | null): SlotType | "full" {
  if (slotTypeFromStart(hhmmOf(start)) === "evening") return "evening"
  if (!end) return "morning"
  const s = hhmmOf(start), e = hhmmOf(end)
  return e <= s || e > "16:00" ? "full" : "morning"
}

/** Whether a block with this time_slot covers a booking starting at `bookingStart`. */
export function blockCoversStart(timeSlot: BlockSlot, bookingStart: string): boolean {
  return timeSlot === "all_day" || slotTypeFromStart(hhmmOf(bookingStart)) === timeSlot
}

/**
 * The space's slots a block would hit. Empty = the block has no effect on this space —
 * e.g. an "evening" block on a space whose only slot is 10:00–03:00 (J-dagen 2026-11-06).
 */
export function slotsCoveredByBlock(slots: Slot[] | null | undefined, timeSlot: BlockSlot): Slot[] {
  return (slots ?? []).filter((s) => s?.start && blockCoversStart(timeSlot, s.start))
}

/**
 * The dates a block of this type would hit for one booking: its start date when the block
 * covers its start, and for "all_day" also the next day when the booking runs past midnight
 * (10:00–03:00 the 6th is still on the space at 02:00 the 7th). Servers match on start date
 * only — this is for warnings, it never cancels anything.
 */
export function blockDatesOfBooking(b: { start?: string; end?: string | null }, timeSlot: BlockSlot): string[] {
  if (!b.start) return []
  const dates = blockCoversStart(timeSlot, b.start) ? [b.start.slice(0, 10)] : []
  if (timeSlot === "all_day" && b.end && b.end.includes("T")) {
    const endDate = b.end.slice(0, 10)
    if (endDate > b.start.slice(0, 10) && hhmmOf(b.end) > "00:00") dates.push(endDate)
  }
  return dates
}

/** Bookings on a space + date set that a block would land on (blocks never cancel bookings). */
export function bookingsUnderBlock<B extends { start?: string; end?: string | null; space?: any }>(
  bookings: B[],
  spaceId: string | number,
  dates: string[],
  timeSlot: BlockSlot
): B[] {
  const dateSet = new Set(dates)
  return bookings.filter(
    (b) =>
      String(b.space?.id ?? b.space) === String(spaceId) &&
      blockDatesOfBooking(b, timeSlot).some((d) => dateSet.has(d))
  )
}

/**
 * Bookings that match none of `slots` on both start and end time — they no longer fit
 * after a time change (10–03 → 10–22 or → 10–15 + 16–03 both leave a 10–03 booking out).
 * Bookings are created from slot times, so an exact match is the right test.
 */
export function bookingsOutsideSlots<B extends { start?: string; end?: string | null }>(bookings: B[], slots: Slot[]): B[] {
  const key = (start: string, end?: string | null) => `${hhmmOf(start)}-${end ? hhmmOf(end) : ""}`
  const fits = new Set(slots.filter((s) => s?.start).map((s) => key(s.start, s.end)))
  const starts = new Set(slots.filter((s) => s?.start).map((s) => hhmmOf(s.start)))
  return bookings.filter((b) => b.start && !(b.end ? fits.has(key(b.start, b.end)) : starts.has(hhmmOf(b.start))))
}

/** How much of a space's day a block covers: every slot, some of them, or none. */
export type BlockReach = "all" | "some" | "none"
export function blockReach(slots: Slot[] | null | undefined, timeSlot: BlockSlot): BlockReach {
  const valid = (slots ?? []).filter((s) => s?.start)
  const hit = slotsCoveredByBlock(valid, timeSlot).length
  return hit === 0 ? "none" : hit === valid.length ? "all" : "some"
}

/**
 * Active morning/evening blocks whose reach changes with new slots. On a 10–03 space a
 * morning block closes the whole day; split it into 06–15 + 16–03 and the same block only
 * closes the morning — the evening silently opens. all_day blocks always cover everything.
 */
export function blocksChangingReach<K extends { time_slot?: string; status?: string }>(
  blocks: K[],
  oldSlots: Slot[] | null | undefined,
  newSlots: Slot[]
): { block: K; before: BlockReach; after: BlockReach }[] {
  return blocks
    .filter((b) => b.status !== "archived" && (b.time_slot === "morning" || b.time_slot === "evening"))
    .map((b) => ({
      block: b,
      before: blockReach(oldSlots, b.time_slot as BlockSlot),
      after: blockReach(newSlots, b.time_slot as BlockSlot),
    }))
    .filter((r) => r.before !== r.after)
}
