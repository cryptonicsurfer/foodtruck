"use client"

import { useEffect, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/components/ui/use-toast"
import { SpaceLocationPicker, type LatLng } from "@/components/space-location-picker"
import { adminCreateSpace, adminUpdateSpace, getBookingsForDateRange } from "@/app/actions"
import { bookingsOutsideSlots, blocksChangingReach, shortTimeRange } from "@/lib/booking-rules"
import { Plus, Trash2, AlertTriangle } from "lucide-react"
import { format, addMonths } from "date-fns"
import { sv } from "date-fns/locale"

interface SpaceTimeSlot {
  start: string // "HH:MM"
  end: string // "HH:MM"
  description: string
}

interface AdminSpace {
  id: number
  name: string
  description?: string | null
  location?: { type?: string; coordinates?: [number, number] } | null
  time_slots?: Array<{ start: string; end: string; description?: string }> | null
  bookable_from?: string | null
  bookable_to?: string | null
}

interface SpaceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = create mode */
  space: AdminSpace | null
  /** All blocked dates (admin list) — used to warn when new passes make morning/evening blocks stop working */
  blockedDates?: any[]
  onSaved: () => void
}

const hhmm = (t?: string) => (t ? t.slice(0, 5) : "")
const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t)

export function SpaceDialog({ open, onOpenChange, space, blockedDates = [], onSaved }: SpaceDialogProps) {
  const { toast } = useToast()
  const isEdit = !!space

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [location, setLocation] = useState<LatLng | null>(null)
  const [slots, setSlots] = useState<SpaceTimeSlot[]>([])
  const [limited, setLimited] = useState(false)
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [saving, setSaving] = useState(false)
  const [futureBookings, setFutureBookings] = useState<any[]>([])
  // A failed load must not look like "no conflicts"
  const [bookingsCheck, setBookingsCheck] = useState<"loading" | "ok" | "error">("ok")

  // Seed form from the space whenever the dialog opens
  useEffect(() => {
    if (!open) return
    setName(space?.name ?? "")
    setDescription(space?.description ?? "")
    const coords = space?.location?.coordinates
    setLocation(coords ? { lat: coords[1], lng: coords[0] } : null)
    setSlots(
      (space?.time_slots ?? []).map((s) => ({
        start: hhmm(s.start),
        end: hhmm(s.end),
        description: s.description ?? "Tillgänglig",
      }))
    )
    const f = space?.bookable_from ? String(space.bookable_from).slice(0, 10) : ""
    const t = space?.bookable_to ? String(space.bookable_to).slice(0, 10) : ""
    setFrom(f)
    setTo(t)
    setLimited(Boolean(f || t))
  }, [open, space])

  // Edit mode: load this space's future bookings so a pass change can be checked against them
  useEffect(() => {
    setFutureBookings([])
    setBookingsCheck("ok")
    if (!open || !space) return
    let cancelled = false
    setBookingsCheck("loading")
    const now = new Date()
    getBookingsForDateRange(now.toISOString(), addMonths(now, 18).toISOString())
      .then((res) => {
        if (cancelled) return
        if (!res.success) return setBookingsCheck("error")
        setFutureBookings((res.data || []).filter((b: any) => String(b.space?.id ?? b.space) === String(space.id)))
        setBookingsCheck("ok")
      })
      .catch(() => { if (!cancelled) setBookingsCheck("error") })
    return () => { cancelled = true }
  }, [open, space])

  // What the edited passes would break: bookings that no longer match a pass, blocks that stop working
  const today = format(new Date(), "yyyy-MM-dd")
  const editedSlots = slots.filter((s) => s.start && s.end)
  const slotsChanged = isEdit &&
    JSON.stringify(editedSlots.map((s) => [s.start, s.end])) !==
    JSON.stringify((space?.time_slots ?? []).map((s) => [hhmm(s.start), hhmm(s.end)]))
  const orphanedBookings = slotsChanged ? bookingsOutsideSlots(futureBookings, editedSlots) : []
  const reachChanges = slotsChanged
    ? blocksChangingReach(
        blockedDates.filter((b) => String(b.space?.id ?? b.space) === String(space?.id) && b.date >= today),
        space?.time_slots,
        editedSlots
      )
    : []
  const listBlocks = (rs: typeof reachChanges) =>
    rs.slice(0, 6).map(({ block: b }) => `${b.date}${b.reason ? ` (${b.reason})` : ""}`).join(", ") +
    (rs.length > 6 ? ` och ${rs.length - 6} till` : "")
  const deadBlocks = reachChanges.filter((r) => r.after === "none")
  const narrowedBlocks = reachChanges.filter((r) => r.before === "all" && r.after === "some")
  const wakingBlocks = reachChanges.filter((r) => r.before === "none")

  const updateSlot = (i: number, patch: Partial<SpaceTimeSlot>) =>
    setSlots((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: "Namn krävs", variant: "destructive" })
      return
    }
    if (limited && from && to && from > to) {
      toast({ title: "Från-datum måste vara före till-datum", variant: "destructive" })
      return
    }

    setSaving(true)
    const data = {
      name: name.trim(),
      description: description.trim() || null,
      location: location ? { type: "Point" as const, coordinates: [location.lng, location.lat] as [number, number] } : null,
      time_slots: slots
        .filter((s) => s.start && s.end)
        .map((s) => ({ start: hhmmss(s.start), end: hhmmss(s.end), description: s.description || "Tillgänglig" })),
      bookable_from: limited && from ? from : null,
      bookable_to: limited && to ? to : null,
    }

    const result = isEdit
      ? await adminUpdateSpace(String(space!.id), data)
      : await adminCreateSpace(data)
    setSaving(false)

    if (result.success) {
      toast({ title: isEdit ? "Plats uppdaterad" : "Plats skapad", description: name.trim() })
      onSaved()
      onOpenChange(false)
    } else {
      toast({ title: "Kunde inte spara", description: result.error, variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) onOpenChange(o) }}>
      <DialogContent
        className="max-w-lg flex flex-col gap-4"
        style={{ maxHeight: "92vh", translate: "none", transform: "translate(-50%, -50%)" }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Redigera plats" : "Skapa plats"}</DialogTitle>
          <DialogDescription>
            Namn, beskrivning, plats på kartan, tidsluckor och säsong.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 px-1 -mx-1">
          <div className="space-y-2">
            <Label htmlFor="space-name">Namn *</Label>
            <Input id="space-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="T.ex. Stortorget plats 3" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="space-desc">Beskrivning</Label>
            <Textarea
              id="space-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="T.ex. Tillgång till el - 32A"
            />
          </div>

          <div className="space-y-2">
            <Label>Plats på kartan</Label>
            <SpaceLocationPicker value={location} onChange={setLocation} />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Tidsluckor</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSlots((prev) => [...prev, { start: "10:00", end: "00:00", description: "Tillgänglig" }])}
              >
                <Plus size={14} className="mr-1" /> Lägg till
              </Button>
            </div>
            {slots.length === 0 && (
              <p className="text-xs text-muted-foreground">Inga tidsluckor — platsen blir inte bokningsbar förrän minst en läggs till.</p>
            )}
            <div className="space-y-2">
              {slots.map((slot, i) => (
                <div key={i} className="flex items-end gap-2 rounded-md border p-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Från</Label>
                    <Input type="time" value={slot.start} onChange={(e) => updateSlot(i, { start: e.target.value })} className="w-28" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Till</Label>
                    <Input type="time" value={slot.end} onChange={(e) => updateSlot(i, { end: e.target.value })} className="w-28" />
                  </div>
                  <div className="space-y-1 flex-1">
                    <Label className="text-xs">Beskrivning</Label>
                    <Input value={slot.description} onChange={(e) => updateSlot(i, { description: e.target.value })} />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => setSlots((prev) => prev.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" className="rounded" checked={limited} onChange={(e) => setLimited(e.target.checked)} />
              Begränsa bokningsbar period (säsong)
            </label>
            {limited && (
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="space-y-1 flex-1">
                  <Label htmlFor="space-from" className="text-xs">Bokningsbar från</Label>
                  <Input id="space-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="space-y-1 flex-1">
                  <Label htmlFor="space-to" className="text-xs">Bokningsbar till</Label>
                  <Input id="space-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </div>

        {slotsChanged && bookingsCheck === "loading" && (
          <p className="text-xs text-muted-foreground">Kontrollerar framtida bokningar…</p>
        )}
        {slotsChanged && bookingsCheck === "error" && (
          <div className="flex gap-2 rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-900">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <p>Kunde inte kontrollera bokningarna, så det går inte att se om de nya passen krockar med något. Stäng och öppna igen, eller logga in på nytt.</p>
          </div>
        )}
        {(orphanedBookings.length > 0 || reachChanges.length > 0) && (
          <div className="flex gap-2 rounded-md border border-amber-400 bg-amber-50 p-3 text-xs text-amber-950">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <div className="space-y-1">
              {orphanedBookings.length > 0 && (
                <p>
                  <strong>{orphanedBookings.length} framtida {orphanedBookings.length === 1 ? "bokning passar" : "bokningar passar"} inte
                  de nya passen</strong> och ligger kvar med sina gamla tider. Kontakta foodtruckarna:{" "}
                  {orphanedBookings.slice(0, 6).map((b) =>
                    `${b.foodtruck?.name ?? "Okänd"} ${format(new Date(b.start.slice(0, 10) + "T12:00:00"), "d MMM", { locale: sv })} (${shortTimeRange(b.start, b.end)})`
                  ).join(", ")}
                  {orphanedBookings.length > 6 ? ` och ${orphanedBookings.length - 6} till` : ""}.
                </p>
              )}
              {deadBlocks.length > 0 && (
                <p>
                  <strong>{deadBlocks.length} {deadBlocks.length === 1 ? "spärr slutar" : "spärrar slutar"} gälla</strong>,
                  eftersom de gäller morgon- eller kvällspass som platsen inte längre har: {listBlocks(deadBlocks)}.
                  Lägg om dem som hela dagen.
                </p>
              )}
              {narrowedBlocks.length > 0 && (
                <p>
                  <strong>{narrowedBlocks.length} {narrowedBlocks.length === 1 ? "spärr stänger" : "spärrar stänger"} inte
                  längre hela dagen</strong>, bara passen före eller från 16, så resten av dagen blir bokningsbar: {listBlocks(narrowedBlocks)}. Lägg om dem som hela dagen om hela dagen ska vara stängd.
                </p>
              )}
              {wakingBlocks.length > 0 && (
                <p>
                  <strong>{wakingBlocks.length} {wakingBlocks.length === 1 ? "gammal spärr börjar" : "gamla spärrar börjar"} gälla
                  igen</strong> med de nya passen: {listBlocks(wakingBlocks)}. Ta bort dem om de inte längre behövs.
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Avbryt
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim() || (slotsChanged && bookingsCheck === "loading")}>
            {saving ? "Sparar…" : isEdit ? "Spara" : "Skapa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
