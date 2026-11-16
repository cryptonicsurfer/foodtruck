import { test } from "node:test"
import assert from "node:assert/strict"
import { buildDay, byTruck, pickDay, addDays, stockholmLocal, cancelledLate, distanceM, stamp } from "./public-schedule.ts"

const pt = (lng: number, lat: number) => ({ type: "Point", coordinates: [lng, lat] as [number, number] })
const heldag = [{ start: "10:00:00", end: "03:00:00" }]
const spaces = [
  { id: 5, name: "Rådhustorget plats 6", location: pt(12.4919, 56.9039), time_slots: heldag },
  { id: 4, name: "Rådhustorget plats 5", address: "Rådhustorget, Centrum", location: pt(12.4917, 56.904), time_slots: heldag },
  { id: 9, name: "Bacchus", location: null, time_slots: heldag },
]
const truck = (id: number, name: string) => ({ id, name, image: null })
const bookings = [
  { id: 1, start: "2026-07-10T10:00:00", end: "2026-07-11T03:00:00", date_created: "2026-07-01T08:00:00.000", space: 4, foodtruck: truck(23, "Sweets") },
  { id: 2, start: "2026-07-11T10:00:00", end: "2026-07-12T03:00:00", date_created: "2026-07-11T07:55:00.000", space: { id: 5 }, foodtruck: truck(17, "Grill") },
]
const cancelled = [
  { id: 1, start: "2026-07-11T10:00:00", end: "2026-07-12T03:00:00", booked_at: "2026-07-01T08:00:00Z", cancelled_at: "2026-07-11T07:50:00Z", space: 5, foodtruck: truck(23, "Sweets") },
  { id: 2, start: "2026-07-11T10:00:00", end: "2026-07-12T03:00:00", booked_at: "2026-06-20T08:00:00Z", cancelled_at: "2026-07-01T07:50:00Z", space: 4, foodtruck: truck(17, "Grill") },
]

test("stockholmLocal: sommartid och vintertid", () => {
  assert.equal(stockholmLocal(new Date("2026-07-11T07:50:00Z")), "2026-07-11T09:50:00")
  assert.equal(stockholmLocal(new Date("2026-12-31T23:30:00Z")), "2027-01-01T00:30:00")
})

test("pickDay: ogiltigt eller utanför fönstret ger idag", () => {
  assert.equal(pickDay(undefined, "2026-11-16"), "2026-11-16")
  assert.equal(pickDay("2026-11-10", "2026-11-16"), "2026-11-10")
  assert.equal(pickDay("i-morgon", "2026-11-16"), "2026-11-16")
  assert.equal(pickDay("2026-13-45", "2026-11-16"), "2026-11-16")
  assert.equal(pickDay("2020-01-01", "2026-11-16"), "2026-11-16")
  assert.equal(pickDay("2026-11-31", "2026-11-16"), "2026-11-16") // finns inte, får inte bli 1 dec
  assert.equal(addDays("2026-03-01", -1), "2026-02-28")
})

test("buildDay: dagens bokningar per plats, sorterat på namn", () => {
  const day = buildDay("2026-07-11", "2026-07-11T12:00:00", spaces, bookings, cancelled)
  assert.deepEqual(day.map((s) => s.name), ["Bacchus", "Rådhustorget plats 5", "Rådhustorget plats 6"])
  const p6 = day[2]
  assert.equal(p6.bookings.length, 1)
  assert.equal(p6.bookings[0].truck, "Grill")
  assert.equal(p6.bookings[0].time, "10–03")
  assert.equal(p6.bookings[0].state, "now")
  assert.equal(p6.bookings[0].bookedAt, "11 juli 09:55")
  assert.equal(day[1].lat, 56.904)
  assert.equal(day[0].lat, null)
})

test("buildDay: avbokningen syns på platsen, med tid och sen-flagga", () => {
  const day = buildDay("2026-07-11", "2026-07-11T12:00:00", spaces, bookings, cancelled)
  const p6 = day[2], p5 = day[1]
  assert.equal(p6.cancelled[0].truck, "Sweets")
  assert.equal(p6.cancelled[0].cancelledAt, "11 juli 09:50")
  assert.equal(p6.cancelled[0].late, true)
  assert.equal(p5.cancelled[0].late, false)
  assert.equal(p5.bookings.length, 0) // gårdagens pass (till 03) är slut kl. 12
})

test("buildDay: pass över midnatt syns efter midnatt, men bara idag och tills det är slut", () => {
  const natt = buildDay("2026-07-11", "2026-07-11T01:30:00", spaces, bookings, [])
  assert.equal(natt[1].bookings[0].truck, "Sweets")
  assert.equal(natt[1].bookings[0].sinceYesterday, true)
  assert.equal(natt[1].bookings[0].state, "now")
  assert.equal(natt[2].bookings[0].state, "later")
  const efter = buildDay("2026-07-11", "2026-07-11T03:00:00", spaces, bookings, [])
  assert.equal(efter[1].bookings.length, 0)
  // en annan dag än idag: bara den dagens egna pass
  const bak = buildDay("2026-07-11", "2026-07-20T01:00:00", spaces, bookings, [])
  assert.equal(bak[1].bookings.length, 0)
  assert.equal(bak[2].bookings[0].state, "done")
})

test("buildDay: spärrad plats", () => {
  const blocks = [{ space: 4, date: "2026-07-11", time_slot: "all_day", status: "published" }, { space: 5, date: "2026-07-11", time_slot: "evening", status: "published" }]
  const day = buildDay("2026-07-11", "2026-07-11T12:00:00", spaces, [], [], blocks)
  assert.equal(day[1].blocked, true)
  assert.equal(day[2].blocked, false) // kvällsspärr träffar inte ett pass som börjar 10
})

test("byTruck: samma dag per foodtruck", () => {
  const t = byTruck(buildDay("2026-07-11", "2026-07-11T12:00:00", spaces, bookings, cancelled))
  assert.deepEqual(t.map((x) => x.truck), ["Grill", "Sweets"])
  assert.equal(t[0].booked[0].space, "Rådhustorget plats 6")
  assert.equal(t[0].cancelled[0].space, "Rådhustorget plats 5")
  assert.equal(t[1].booked.length, 0)
  assert.equal(t[1].cancelled[0].cancelledAt, "11 juli 09:50")
})

test("cancelledLate, distanceM, stamp", () => {
  assert.equal(cancelledLate("2026-07-11T10:00:00", "2026-07-10T08:01:00Z"), true) // 10:01 svensk tid dagen före
  assert.equal(cancelledLate("2026-07-11T10:00:00", "2026-07-10T07:59:00Z"), false)
  assert.equal(cancelledLate("2026-07-11T10:00:00", "2026-07-11T12:00:00Z"), true) // efter start
  const d = distanceM(56.88458683, 12.50452861, 56.88450052, 12.504646) // Klittervägen C → D
  assert.ok(d > 8 && d < 16, String(d))
  assert.equal(stamp(null), null)
  assert.equal(stamp("2026-11-14T10:59:26.792"), "14 nov. 11:59") // naiv Directus-tid = UTC
})

test("buildDay: avbokning av ett pass över midnatt syns efter midnatt, så länge passet skulle ha pågått", () => {
  const fre = [{ id: 9, start: "2026-07-10T10:00:00", end: "2026-07-11T03:00:00", booked_at: "2026-07-01T08:00:00Z", cancelled_at: "2026-07-10T21:00:00Z", space: 4, foodtruck: truck(23, "Sweets") }]
  const natt = buildDay("2026-07-11", "2026-07-11T01:00:00", spaces, [], fre)
  assert.equal(natt[1].cancelled.length, 1)
  assert.equal(natt[1].cancelled[0].sinceYesterday, true)
  assert.equal(buildDay("2026-07-11", "2026-07-11T03:00:00", spaces, [], fre)[1].cancelled.length, 0)
  assert.equal(buildDay("2026-07-10", "2026-07-11T01:00:00", spaces, [], fre)[1].cancelled[0].sinceYesterday, false)
})

test("buildDay: borttagen foodtruck behåller sitt namn i avbokningen", () => {
  const rows = [
    { id: 1, start: "2026-07-11T10:00:00", end: "2026-07-12T03:00:00", cancelled_at: "2026-07-11T07:50:00Z", space: 4, foodtruck: null, foodtruck_name: "Nedlagd Vagn" },
    { id: 2, start: "2026-07-11T10:00:00", end: "2026-07-12T03:00:00", cancelled_at: "2026-07-11T07:40:00Z", space: 5, foodtruck: null, foodtruck_name: "Annan Vagn" },
  ]
  const day = buildDay("2026-07-11", "2026-07-11T12:00:00", spaces, [], rows)
  assert.equal(day[1].cancelled[0].truck, "Nedlagd Vagn")
  assert.deepEqual(byTruck(day).map((t) => t.truck), ["Annan Vagn", "Nedlagd Vagn"])
})
