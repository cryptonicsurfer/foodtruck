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
import { adminCreateSpace, adminUpdateSpace } from "@/app/actions"
import { Plus, Trash2 } from "lucide-react"

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
  onSaved: () => void
}

const hhmm = (t?: string) => (t ? t.slice(0, 5) : "")
const hhmmss = (t: string) => (t.length === 5 ? `${t}:00` : t)

export function SpaceDialog({ open, onOpenChange, space, onSaved }: SpaceDialogProps) {
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Avbryt
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Sparar…" : isEdit ? "Spara" : "Skapa"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
