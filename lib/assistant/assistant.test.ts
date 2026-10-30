// Run with `pnpm test`. Space names and coordinates are the real ones (2026-10-30).
import { test } from "node:test"
import assert from "node:assert/strict"
import { matchSpaces, spacesNear, normalize } from "./match.ts"
import { analyzeImpact, expandDates, svDates, type Snapshot } from "./impact.ts"

const pt = (lng: number, lat: number) => ({ type: "Point", coordinates: [lng, lat] as [number, number] })
const heldag = [{ start: "10:00:00", end: "03:00:00" }]
const spaces = [
  { id: 6, name: "\"Åsikten\" - Ågatan", description: "Tillgång till el - elskåp mot Ätran", location: pt(12.49363, 56.90331), time_slots: heldag },
  { id: 9, name: "Bacchus", description: "Tillgång till el - 16A", location: pt(12.47987, 56.88757), time_slots: heldag },
  { id: 10, name: "Klittervägen plats C", description: "Tillgång till el 32A och 16A", location: pt(12.50453, 56.88459), time_slots: heldag },
  { id: 11, name: "Klittervägen plats D", description: "Tillgång till el. 32A och 16A", location: pt(12.50465, 56.8845), time_slots: heldag },
  { id: 12, name: "Klittervägen plats E, Skrea strand", description: "Tillgång till el - 32A", location: pt(12.51332, 56.8772), time_slots: heldag, aliases: ["sanddynevägen"] },
  { id: 13, name: "Klittervägen plats F, Skrea strand", description: "Tillgång till el - 32A", location: pt(12.51368, 56.87723), time_slots: heldag },
  { id: 4, name: "Rådhustorget plats 5", description: "Tillgång till el - 32A", location: pt(12.49167, 56.90396), time_slots: heldag },
  { id: 5, name: "Rådhustorget plats 6", description: "Tillgång till el - 32A", location: pt(12.4919, 56.90392), time_slots: heldag },
  { id: 7, name: "Stortorget", description: "Tillgång till el - 32A", location: pt(12.49149, 56.90541), time_slots: heldag },
  { id: 8, name: "Vallarna", description: "Ingen tillgång till el", location: pt(12.50136, 56.90469), time_slots: heldag },
]

test("platsmatchning: lösa fraser", () => {
  assert.equal(normalize("Rådhustorget"), "radhustorget")
  assert.equal(matchSpaces("vid stortorget", spaces)[0].space.id, 7)
  assert.equal(matchSpaces("platsen vid sanddynevägen", spaces)[0].space.id, 12) // alias
  assert.equal(matchSpaces("klittervägen E", spaces)[0].space.id, 12)
  assert.equal(matchSpaces("radhustorget 6", spaces)[0].space.id, 5)
  assert.equal(matchSpaces("åsikten", spaces)[0].space.id, 6)
  assert.equal(matchSpaces("bacchus", spaces)[0].space.id, 9)
  // "Rådhustorget" alone is ambiguous: both 5 and 6, the assistant must ask
  assert.deepEqual(matchSpaces("rådhustorget", spaces).slice(0, 2).map((m) => m.space.id).sort(), [4, 5])
  assert.equal(matchSpaces("platsen", spaces).length, 0)
})

test("platsmatchning: närmast en punkt", () => {
  const near = spacesNear([12.4916, 56.9039], spaces, 100)
  assert.deepEqual(near.map((n) => n.space.id), [4, 5])
})

const data = (over: Partial<Snapshot> = {}): Snapshot => ({
  today: "2026-10-30",
  spaces,
  bookings: [{ id: 1, start: "2026-11-06T10:00:00", end: "2026-11-07T03:00:00", space: { id: 4, name: "Rådhustorget plats 5" }, foodtruck: { id: 3, name: "Testtruck" } }],
  blocks: [],
  foodtrucks: [{ id: 3, name: "Testtruck", active: true, user: { id: "u1", email: "test@exempel.se" } }],
  rules: { maximum_days_ahead: 60 },
  ...over,
})

test("kort: spärr på bokad dag varnar, kvällsspärr på heldagsplats stoppas", () => {
  const all = analyzeImpact({ kind: "block", space_ids: [4, 5], dates: ["2026-11-06"], time_slot: "all_day", reason: "J-dagen" }, data())
  assert.equal(all.stopped, false)
  assert.equal(all.warnings[0].rule, "block-on-booking")
  assert.match(all.lines.at(-1)!, /Skapar 2 spärrar/)
  const evening = analyzeImpact({ kind: "block", space_ids: [4], dates: ["2026-11-09"], time_slot: "evening" }, data())
  assert.equal(evening.stopped, true)
  const past = analyzeImpact({ kind: "block", space_ids: [4], dates: ["2026-10-01"], time_slot: "all_day" }, data())
  assert.equal(past.stopped, true)
})

test("kort: redan spärrade dagar hoppas över", () => {
  const c = analyzeImpact(
    { kind: "block", space_ids: [7], dates: ["2026-11-10", "2026-11-11"], time_slot: "all_day" },
    data({ blocks: [{ id: 9, space: 7, date: "2026-11-10", time_slot: "all_day" }] })
  )
  assert.match(c.lines.join("\n"), /Skapar 1 spärr\./)
  const dupRows = analyzeImpact(
    { kind: "block", space_ids: [7], dates: ["2026-11-10", "2026-11-11"], time_slot: "all_day" },
    data({ blocks: [{ id: 9, space: 7, date: "2026-11-10", time_slot: "all_day" }, { id: 10, space: 7, date: "2026-11-10", time_slot: "all_day" }] })
  )
  assert.match(dupRows.lines.join("\n"), /Skapar 1 spärr\./)
  assert.equal(dupRows.stopped, false)
  const none = analyzeImpact(
    { kind: "block", space_ids: [7], dates: ["2026-11-10"], time_slot: "all_day" },
    data({ blocks: [{ id: 9, space: 7, date: "2026-11-10", time_slot: "all_day" }] })
  )
  assert.equal(none.stopped, true)
})

test("kort: passändring och foodtruckers", () => {
  const split = analyzeImpact({ kind: "update_space", space_id: 4, changes: { time_slots: [{ start: "06:00", end: "15:00" }, { start: "16:00", end: "03:00" }] } }, data())
  assert.deepEqual(split.warnings.map((w) => w.rule), ["slots-orphan-bookings", "slots-off-template"])
  const dup = analyzeImpact({ kind: "create_foodtrucker", first_name: "A", last_name: "B", email: "TEST@exempel.se", foodtruck_name: "Ny" }, data())
  assert.equal(dup.stopped, true)
  const del = analyzeImpact({ kind: "delete_foodtrucker", foodtruck_id: 3, delete_user: true }, data())
  assert.equal(del.requireText, "bekräfta")
  assert.equal(del.warnings[0].rule, "delete-with-bookings")
})

test("kort: ny plats med säsong som redan passerat varnar", () => {
  const c = analyzeImpact({ kind: "create_space", name: "Tullbron plats 1", lng: 12.494, lat: 56.903, time_slots: [{ start: "10:00", end: "03:00" }], bookable_from: "2026-06-01", bookable_to: "2026-08-31" }, data())
  assert.deepEqual(c.warnings.map((w) => w.rule), ["season-past"])
  assert.equal(c.stopped, false)
})

test("kort: ny plats med ett namn som redan finns stoppas", () => {
  const c = analyzeImpact({ kind: "create_space", name: "stortorget ", lng: 12.49, lat: 56.9, time_slots: [{ start: "10:00", end: "03:00" }] }, data())
  assert.equal(c.stopped, true)
})

test("datum: intervall och etiketter", () => {
  assert.equal(expandDates("2026-12-30", "2027-01-02").length, 4)
  assert.equal(svDates(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-20"]), "9–11 nov 2026, 20 nov 2026")
})
