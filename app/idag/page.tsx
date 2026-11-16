/**
 * /idag — the public control page. No login: police and parking officers check that the
 * foodtruck standing on a space is the one booked there, and see bookings that were
 * cancelled (and when). Hidden from search engines (robots meta here, X-Robots-Tag in
 * next.config.ts). Shows foodtruck names only — no owner names or e-mail.
 *
 * Data comes through the read-only service account in lib/public-data.ts.
 * Off (404) unless PUBLIC_SCHEDULE_ENABLED=1 and PUBLIC_SCHEDULE_TOKEN is set.
 */
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { loadDay, publicScheduleEnabled } from "@/lib/public-data"
import { addDays, buildDay, byTruck, longDay, pickDay, stockholmLocal } from "@/lib/public-schedule"
import { PublicSchedule } from "@/components/public-schedule"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Foodtrucks i Falkenberg: bokade platser",
  description: "Vilken foodtruck är bokad på vilken plats, dag för dag.",
  robots: { index: false, follow: false, nocache: true },
}

export default async function IdagPage({ searchParams }: { searchParams: Promise<{ d?: string }> }) {
  if (!publicScheduleEnabled()) notFound()

  const now = stockholmLocal(new Date())
  const today = now.slice(0, 10)
  const day = pickDay((await searchParams).d, today)

  let view: React.ComponentProps<typeof PublicSchedule> | null = null
  try {
    const data = await loadDay(day)
    const spaces = buildDay(day, now, data.spaces, data.bookings, data.cancelled ?? [], data.blocks)
    view = {
      day,
      today,
      dayLabel: longDay(day),
      prev: addDays(day, -1),
      next: addDays(day, 1),
      updated: now.slice(11, 16),
      spaces,
      trucks: byTruck(spaces),
      cancelledKnown: data.cancelled !== null,
      assetsUrl: `${process.env.NEXT_PUBLIC_DIRECTUS_URL || "https://cms.businessfalkenberg.se"}/assets`,
    }
  } catch (e) {
    console.error("Publik sida: kunde inte hämta dagen:", e)
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-4">
        <p className="text-sm text-muted-foreground">Falkenbergs kommun · foodtruckplatser</p>
        <h1 className="text-2xl font-semibold leading-tight">Vem är bokad var?</h1>
      </header>
      {view ? (
        <PublicSchedule {...view} />
      ) : (
        // Never show an empty list when the data is missing — "no booking" would be a false answer.
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
          Bokningarna kunde inte hämtas just nu. Sidan visar därför ingenting, hellre än fel uppgifter.
          Försök igen om en stund.
        </p>
      )}
    </main>
  )
}
