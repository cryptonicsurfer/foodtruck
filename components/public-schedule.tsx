"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronLeft, ChevronRight, LocateFixed, MapPin, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { distanceM, type DaySpace, type TruckDay } from "@/lib/public-schedule"

type Props = {
  day: string
  today: string
  dayLabel: string
  prev: string
  next: string
  updated: string
  spaces: DaySpace[]
  trucks: TruckDay[]
  cancelledKnown: boolean
  assetsUrl: string
}

const STATE_LABEL = { now: "Pågår nu", later: "Börjar senare", done: "Avslutat" } as const

function metres(m: number): string {
  return m < 1000 ? `${Math.round(m / 5) * 5 || 5} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`
}

export function PublicSchedule({ day, today, dayLabel, prev, next, updated, spaces, trucks, cancelledKnown, assetsUrl }: Props) {
  const router = useRouter()
  const [view, setView] = useState<"spaces" | "trucks">("spaces")
  const [q, setQ] = useState("")
  const [pos, setPos] = useState<{ lat: number; lng: number; acc: number } | null>(null)
  const [posError, setPosError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const isToday = day === today

  // Today's view keeps itself fresh; a booking or cancellation shows within a minute.
  useEffect(() => {
    if (!isToday) return
    const tick = () => { if (document.visibilityState === "visible") router.refresh() }
    const id = setInterval(tick, 60_000)
    document.addEventListener("visibilitychange", tick)
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick) }
  }, [isToday, router])

  function locate() {
    if (!("geolocation" in navigator)) { setPosError("Den här enheten kan inte visa din position."); return }
    setLocating(true); setPosError(null)
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }); setLocating(false) },
      () => { setPosError("Positionen kunde inte hämtas. Tillåt platsåtkomst för sidan och försök igen."); setLocating(false) },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 }
    )
  }

  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => {
    const withDist = spaces.map((s) => ({
      ...s,
      dist: pos && s.lat != null && s.lng != null ? distanceM(pos.lat, pos.lng, s.lat, s.lng) : null,
    }))
    const hit = (s: (typeof withDist)[number]) =>
      !needle ||
      [s.name, s.address ?? "", ...s.bookings.map((b) => b.truck), ...s.cancelled.map((c) => c.truck)].some((t) => t.toLowerCase().includes(needle))
    const list = withDist.filter(hit)
    if (pos) list.sort((a, b) => (a.dist ?? Infinity) - (b.dist ?? Infinity))
    return list
  }, [spaces, pos, needle])
  const shownTrucks = trucks.filter((t) => !needle || [t.truck, ...t.booked.map((b) => b.space), ...t.cancelled.map((c) => c.space)].some((x) => x.toLowerCase().includes(needle)))

  const booked = spaces.filter((s) => s.bookings.length > 0).length
  const cancelledCount = spaces.reduce((n, s) => n + s.cancelled.length, 0)

  return (
    <div>
      <nav aria-label="Välj dag" className="mb-3 flex items-center gap-2">
        <Button asChild variant="outline" size="icon" aria-label="Föregående dag"><Link href={`/idag?d=${prev}`}><ChevronLeft /></Link></Button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-lg font-semibold first-letter:uppercase">{isToday ? `Idag, ${dayLabel}` : dayLabel}</p>
        </div>
        <Button asChild variant="outline" size="icon" aria-label="Nästa dag"><Link href={`/idag?d=${next}`}><ChevronRight /></Link></Button>
      </nav>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="dag">Datum</label>
        <input
          id="dag" type="date" value={day}
          onChange={(e) => e.target.value && router.push(`/idag?d=${e.target.value}`)}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        />
        {!isToday && <Button asChild variant="secondary" size="sm"><Link href="/idag">Till idag</Link></Button>}
        <p className="ml-auto text-sm text-muted-foreground" aria-live="polite">
          {isToday ? `Uppdaterad ${updated}` : "Annan dag än idag"}
        </p>
      </div>

      <p className="mb-4 text-sm">
        <strong>{booked}</strong> av {spaces.length} platser är bokade
        {cancelledKnown && cancelledCount > 0 && <> · <strong>{cancelledCount}</strong> {cancelledCount === 1 ? "bokning" : "bokningar"} avbokade</>}
      </p>
      {!cancelledKnown && (
        <p role="alert" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Avbokningarna kunde inte hämtas just nu. Bokningarna nedan stämmer, men borttagna bokningar visas inte.
        </p>
      )}

      <div className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Sök foodtruck eller plats" aria-label="Sök foodtruck eller plats" className="pl-8" />
        </div>
        <Button variant={pos ? "secondary" : "outline"} onClick={locate} disabled={locating}>
          <LocateFixed aria-hidden /> {locating ? "Söker…" : "Närmast mig"}
        </Button>
      </div>
      {posError && <p role="alert" className="mb-3 text-sm text-red-700">{posError}</p>}
      {pos && (
        <p className="mb-3 text-sm text-muted-foreground">
          Platserna är sorterade efter avstånd (positionen stämmer på ungefär {metres(pos.acc)}). Flera platser ligger bara några meter från varandra, så jämför med platsens namn.
        </p>
      )}

      <div role="tablist" aria-label="Visning" className="mb-4 grid grid-cols-2 rounded-lg border p-1 text-sm">
        {(["spaces", "trucks"] as const).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)}
            className={cn("rounded-md py-1.5 font-medium", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
            {v === "spaces" ? "Per plats" : "Per foodtruck"}
          </button>
        ))}
      </div>

      {view === "spaces" ? (
        <ul className="space-y-3">
          {shown.map((s) => (
            <li key={s.id} className="rounded-xl border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-semibold leading-snug">{s.name}</h2>
                  {s.address && <p className="text-sm text-muted-foreground">{s.address}</p>}
                </div>
                <div className="shrink-0 text-right text-sm">
                  {s.dist != null && <p className="font-medium tabular-nums">{metres(s.dist)}</p>}
                  {s.lat != null && s.lng != null && (
                    <a className="inline-flex items-center gap-1 text-muted-foreground underline underline-offset-2"
                      href={`https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=19/${s.lat}/${s.lng}`} target="_blank" rel="noreferrer">
                      <MapPin className="size-3.5" aria-hidden />Karta
                    </a>
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {s.bookings.length === 0 && (
                  <p className="rounded-lg bg-muted px-3 py-2 text-sm">
                    {s.blocked ? "Platsen är spärrad den här dagen. Ingen bokning." : "Ingen bokning den här dagen."}
                  </p>
                )}
                {s.bookings.map((b) => (
                  <div key={b.id} className={cn("flex items-center gap-3 rounded-lg border px-3 py-2", b.state === "now" && "border-emerald-600/50 bg-emerald-50 dark:bg-emerald-950/40")}>
                    {b.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`${assetsUrl}/${b.image}?width=112&height=112&fit=cover`} alt="" width={56} height={56} className="size-14 shrink-0 rounded-md object-cover" />
                    ) : (
                      <div className="size-14 shrink-0 rounded-md bg-muted" aria-hidden />
                    )}
                    <div className="min-w-0">
                      <p className="font-semibold leading-snug">{b.truck}</p>
                      <p className="text-sm">
                        <span className="tabular-nums">Bokad {b.time}</span>
                        {b.sinceYesterday && " (sedan igår)"} · {b.state === "later" && !isToday ? "Kommande" : STATE_LABEL[b.state]}
                      </p>
                      {b.bookedAt && <p className="text-xs text-muted-foreground">Bokningen gjordes {b.bookedAt}</p>}
                    </div>
                  </div>
                ))}
                {s.cancelled.map((c) => (
                  <div key={c.id} className="rounded-lg border border-dashed border-amber-500/70 bg-amber-50 px-3 py-2 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
                    <p className="text-sm">
                      <span className="font-semibold">{c.truck}</span> var bokad här <span className="tabular-nums">{c.time}</span>{c.sinceYesterday && " (sedan igår)"}, men <strong>bokningen togs bort {c.cancelledAt}</strong>.
                    </p>
                    <p className="text-xs opacity-80">
                      {c.late ? "Avbokad mindre än 24 timmar före start. " : ""}{c.bookedAt ? `Bokningen gjordes ${c.bookedAt}.` : ""}
                    </p>
                  </div>
                ))}
              </div>
            </li>
          ))}
          {shown.length === 0 && <li className="rounded-lg bg-muted p-4 text-sm">Ingen plats eller foodtruck matchar sökningen.</li>}
        </ul>
      ) : (
        <ul className="space-y-3">
          {shownTrucks.map((t) => (
            <li key={t.truckId} className="rounded-xl border bg-card p-4">
              <h2 className="font-semibold">{t.truck}</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {t.booked.map((b, i) => (
                  <li key={`b${i}`}>Bokad på <strong>{b.space}</strong> <span className="tabular-nums">{b.time}</span>{b.state === "now" ? " · pågår nu" : ""}</li>
                ))}
                {t.booked.length === 0 && <li>Ingen gällande bokning den här dagen.</li>}
                {t.cancelled.map((c, i) => (
                  <li key={`c${i}`} className="text-amber-800 dark:text-amber-200">Avbokade {c.space} <span className="tabular-nums">{c.time}</span>, borttagen {c.cancelledAt}</li>
                ))}
              </ul>
            </li>
          ))}
          {shownTrucks.length === 0 && (
            <li className="rounded-lg bg-muted p-4 text-sm">{needle ? "Ingen foodtruck matchar sökningen." : "Ingen foodtruck har bokat eller avbokat den här dagen."}</li>
          )}
        </ul>
      )}

      <footer className="mt-8 space-y-1 text-xs text-muted-foreground">
        <p>En foodtruck som står på en plats utan att finnas med här har ingen bokning i systemet för den dagen.</p>
        {cancelledKnown && <p>Borttagna bokningar visas med tidpunkten då de togs bort.</p>}
        <p>Frågor: Business Falkenberg, Falkenbergs kommun.</p>
      </footer>
    </div>
  )
}
