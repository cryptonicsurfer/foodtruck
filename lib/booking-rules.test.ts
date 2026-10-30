// Run with `pnpm test` (node --test, type stripping — no test framework dependency).
import { test } from "node:test"
import assert from "node:assert/strict"
import {
  slotKind, shortTimeRange, slotsCoveredByBlock, bookingsUnderBlock,
  bookingsOutsideSlots, blocksChangingReach, blockReach,
} from "./booking-rules.ts"

const heldag = [{ start: "10:00:00", end: "03:00:00" }]
const tvaPass = [{ start: "06:00:00", end: "15:00:00" }, { start: "16:00:00", end: "03:00:00" }]
const takeAndGo = { start: "2026-11-06T10:00:00", end: "2026-11-07T03:00:00", space: { id: 4 } }

test("slotKind: heldag, morgon, kväll", () => {
  assert.equal(slotKind("10:00:00", "03:00:00"), "full")
  assert.equal(slotKind("10:00:00", "00:00:00"), "full")
  assert.equal(slotKind("06:00:00", "15:00:00"), "morning")
  assert.equal(slotKind("16:00:00", "03:00:00"), "evening")
  assert.equal(slotKind("2026-11-06T10:00:00", "2026-11-07T03:00:00"), "full")
})

test("shortTimeRange", () => {
  assert.equal(shortTimeRange("10:00:00", "03:00:00"), "10–03")
  assert.equal(shortTimeRange("15:30:00", "22:00:00"), "15:30–22")
})

test("J-dagen: kvällsspärr träffar inget pass på en heldagsplats", () => {
  assert.equal(slotsCoveredByBlock(heldag, "evening").length, 0)
  assert.equal(slotsCoveredByBlock(heldag, "morning").length, 1)
  assert.equal(slotsCoveredByBlock(heldag, "all_day").length, 1)
  assert.equal(slotsCoveredByBlock(tvaPass, "evening").length, 1)
})

test("bookingsUnderBlock följer pass, plats och datum", () => {
  const b = [takeAndGo]
  assert.equal(bookingsUnderBlock(b, 4, ["2026-11-06"], "all_day").length, 1)
  assert.equal(bookingsUnderBlock(b, 4, ["2026-11-06"], "morning").length, 1)
  assert.equal(bookingsUnderBlock(b, 4, ["2026-11-06"], "evening").length, 0)
  assert.equal(bookingsUnderBlock(b, 5, ["2026-11-06"], "all_day").length, 0)
  assert.equal(bookingsUnderBlock(b, 4, ["2026-11-08"], "all_day").length, 0)
})

test("heldagsspärr dagen efter fångar en bokning som går över midnatt", () => {
  const b = [takeAndGo]
  assert.equal(bookingsUnderBlock(b, 4, ["2026-11-07"], "all_day").length, 1)
  assert.equal(bookingsUnderBlock(b, 4, ["2026-11-07"], "morning").length, 0)
  const tillMidnatt = { start: "2026-11-06T16:00:00", end: "2026-11-07T00:00:00", space: { id: 4 } }
  assert.equal(bookingsUnderBlock([tillMidnatt], 4, ["2026-11-07"], "all_day").length, 0)
})

test("tidsändring: start och slut måste passa ett pass", () => {
  assert.equal(bookingsOutsideSlots([takeAndGo], heldag).length, 0)
  assert.equal(bookingsOutsideSlots([takeAndGo], tvaPass).length, 1)
  assert.equal(bookingsOutsideSlots([takeAndGo], [{ start: "10:00", end: "22:00" }]).length, 1)
  assert.equal(bookingsOutsideSlots([takeAndGo], [{ start: "10:00", end: "15:00" }, { start: "16:00", end: "03:00" }]).length, 1)
  assert.equal(bookingsOutsideSlots([{ start: "2026-11-06T10:00:00" }], heldag).length, 0)
})

test("tidsändring: spärrar som ändrar räckvidd", () => {
  assert.equal(blockReach(heldag, "morning"), "all")
  assert.equal(blockReach(tvaPass, "morning"), "some")
  assert.equal(blockReach(heldag, "evening"), "none")
  const blocks = [{ time_slot: "morning" }, { time_slot: "evening" }, { time_slot: "all_day" }, { time_slot: "evening", status: "archived" }]
  // Heldag → två pass: morgonspärren täcker bara morgonen, kvällsspärren börjar gälla
  const split = blocksChangingReach(blocks, heldag, tvaPass)
  assert.deepEqual(split.map((r) => [r.block.time_slot, r.before, r.after]), [["morning", "all", "some"], ["evening", "none", "some"]])
  // Två pass → heldag: kvällsspärren slutar gälla
  const merge = blocksChangingReach(blocks, tvaPass, heldag)
  assert.deepEqual(merge.map((r) => [r.block.time_slot, r.after]), [["morning", "all"], ["evening", "none"]])
  assert.equal(blocksChangingReach(blocks, heldag, heldag).length, 0)
})
