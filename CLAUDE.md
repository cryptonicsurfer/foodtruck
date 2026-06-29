# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
- `pnpm dev` - Start development server with turbopack
- `pnpm build` - Build for production
- `pnpm start` - Start production server
- `pnpm lint` - Run ESLint

## Architecture Overview

### Tech Stack
- Next.js 15 with App Router and Turbopack
- React 19 with TanStack Query for data fetching
- Tailwind CSS 4 with shadcn/ui components (Radix UI primitives)
- Directus CMS backend at cms.businessfalkenberg.se
- **Two different maps**: the public booking/spaces map in the app is **Google
  Maps** (`@react-google-maps/api`, referrer-locked `foodtruck-maps-js` key);
  the `spaces.location` editor inside **Directus admin** is the CMS's own
  **OpenStreetMap/MapLibre** widget. Coordinates are stored once as a PostGIS
  Point (SRID 4326, GeoJSON `[lng, lat]`) and rendered by both.

### Key Architectural Patterns

**Server Actions Pattern**: All Directus API communication flows through:
1. `app/actions.ts` - Server actions that handle authentication and call directusServer
2. `lib/directus-server.ts` - Low-level Directus API wrapper with typed requests

**Authentication Flow**:
- Directus auth with JWT tokens stored in httpOnly cookies (`access_token`, `refresh_token`)
- `lib/auth-context.tsx` - Client-side auth state management via React Context
- `components/protected-route.tsx` - Route protection wrapper with redirect-after-login support
- Auth pages: `/login`, `/auth/password-request`, `/auth/password-reset`
- No signup page (users created in Directus admin)
- **Booking is owner-only**: `/booking` only works for a user whose account has a
  linked `foodtruck` (the Foodtrucker role). Admin / "Head of Foodtruck" accounts
  have **no** foodtruck, so `handleBookSpace` returns early — the page shows an
  amber "ingen foodtruck kopplad" banner (gated by a `userLoaded` flag) instead
  of letting them book. To test the booking flow, log in as a foodtruck account.
- Admin roles (`/admin` access): `ADMIN_ROLES = ['Administrator', 'Head of Foodtruck']` in `app/actions.ts`.

**Provider Hierarchy** (in `app/layout.tsx`):
```
EnvProvider → QueryProvider → AuthProvider → MapsProvider
```
The shadcn `<Toaster />` is also mounted in `app/layout.tsx` (after the
providers). It must stay mounted — without it, every `toast()` call across the
app silently does nothing (see Gotchas).

### Directus Schema

**Collections:**
- `foodtrucks` - id, name, user (FK to Directus user), bookings relation
- `spaces` - id, name, location (PostGIS Point, SRID 4326, `[lng, lat]`; spaces without it just don't get a map marker — booking still works via the list), time_slots, bookings relation, `bookable_from`/`bookable_to` (date, nullable — seasonal booking window; null = always bookable)
- `foodtruck_bookings` - id, foodtruck (FK), space (FK), start, end datetimes
- `foodtruck_rules` - Booking rules (max_future_bookings, max_days_ahead, last_minute_booking_hours)
- `space_blocked_dates` - id, space (FK), date (`yyyy-MM-dd`), time_slot (`morning` | `evening` | `all_day`), reason?, status (`published` | `archived`). Admin-managed; `createBooking()` rejects bookings via `isSpaceBlocked()` before they're created. Independent of `foodtruck_rules`.

**Key Relationships:**
- Food truck owners (Directus users) have one food truck
- Food trucks and spaces have many bookings
- Each booking links one food truck to one space for a time period

### Admin: schedule / parking-officer overview (`/admin` → "Schema")

Leftmost admin tab. A read-only roster so a parking officer (parkeringsvakt) can
see, per day and space, which foodtruck gets to stand where. Bookings (today →
+12 months) are lazy-loaded via `getBookingsForDateRange()` the first time the
tab is opened (and re-fetchable with "Uppdatera"). NB: that Directus query is
pinned to `sort=start&limit=-1` — without `limit=-1` Directus caps at 100 rows,
which silently dropped whole days from busy ranges. Date and slot are parsed
straight from the raw start string (`start.slice(0,10)` / hour `slice(11,13)`),
not `new Date()`, to avoid timezone midnight-shifts. Filters: from-date (default
today), optional to-date, and space. Rows are grouped by date (ascending),
then sorted by space name then slot. Slot is derived from the booking start hour
(`<16` → morning, else evening — same rule as `available-slots-dialog.tsx`),
shown as an amber Sun / indigo Moon badge. Each row shows a foodtruck image
thumbnail (Directus `?width=88&height=88&fit=cover`) + space + foodtruck name +
slot. Rows are buttons: tapping one opens a preview Dialog (`scheduleDetail`
state) with the full foodtruck info — hero image, name, description, owner +
email (mailto), total booking count — plus the booking's date/space/slot, so the
officer never has to leave `/admin`. Image/owner/description come from the
already-loaded `adminGetAllFoodTrucks()` data (matched by id via
`foodTruckById`), not from the booking query — no change to the shared
`getBookingsForDateRange()`. The preview Dialog can grow tall (long
descriptions), so it uses the tall-dialog centering fix (see Gotchas):
`style={{ maxHeight: "92vh", translate: "none", transform: "translate(-50%,-50%)" }}`
with `flex flex-col`, a `shrink-0` hero image, and a `flex-1 min-h-0
overflow-y-auto` scrollable body.

### Admin: space management (`/admin` → "Platser")

Full space CRUD in-app so colleagues never need Directus for spaces. The
"Platser" tab lists spaces (coordinate-set?, # time_slots, season summary) with
**Skapa plats** / **Redigera** / **Ta bort**. Create/edit open `SpaceDialog`
(`components/space-dialog.tsx`): name, description, a **Google Maps
click-to-set coordinate picker** (`components/space-location-picker.tsx`,
reuses the app's working Maps via `useMapsApi` — deliberately NOT the Directus
OSM widget), a `time_slots` editor (rows of `HH:MM` start/end + description),
and the seasonal window. Saves go through `adminCreateSpace` / `adminUpdateSpace`
(broadened to name/description/location/time_slots/bookable_*). `location` is
written as a GeoJSON `Point` `{type:"Point", coordinates:[lng,lat]}`; read back
the same way (`coordinates[1]`=lat). Delete uses `<ConfirmDialog>` with
`requireText="bekräfta"` (`adminDeleteSpace`; fails if bookings reference it).
Permissions: the "Head of food truck spaces" policy grants create/update/delete
on spaces; regular "Food truck" policy is read-only.

**Seasonal window**: `spaces.bookable_from` / `bookable_to` (date, nullable;
null = always bookable), edited in `SpaceDialog` behind a "Begränsa bokningsbar
period" checkbox (unchecked = no limit — avoids Safari painting today into an
empty `<input type=date>`). The booking page disables out-of-window slots
(`seasonStatus()`, amber "Bokningsbar DD/MM–DD/MM") and `createBooking()`
enforces it server-side. All date comparisons use raw `yyyy-MM-dd` strings.

### Admin: booking rules (`/admin` → "Inställningar")

The `foodtruck_rules` singleton (max future bookings, max days ahead,
last-minute hours) is **editable in-app** via `adminUpdateBookingRules()` —
no longer Directus-only. Save routes through a plain `<ConfirmDialog>` ("vill du
göra dessa ändringar?"). The "Head of food truck spaces" policy grants
`foodtruck_rules.update`.

**Confirm pattern**: `components/confirm-dialog.tsx` — reusable; `requireText`
forces typing an exact word (e.g. "bekräfta") before the confirm button enables.
Used for destructive actions; plain (no `requireText`) for sensitive saves.

**Why a Directus restart was needed once:** the two columns + their
`directus_fields` rows were added straight to the DB via SQL (to avoid touching
the shared CMS through its API mid-session). Directus loads its schema at boot
and won't notice direct DB schema changes until restarted — so a one-time
`docker restart directus-directus-1` was required to expose the fields (this
briefly interrupts auth across the whole VPS app fleet — Directus is the shared
auth backend). Future field additions should ideally go through the Directus
admin UI/API instead, which hot-reloads the schema.

### Admin: blocked dates (`/admin` → "Spärrade datum")

The block-date dialog has two modes via a toggle:
- **Spärra dag** — single date via a native date input → one `adminCreateSpaceBlockedDate()`.
- **Spärra period** — `components/multi-date-calendar.tsx`: a month grid (Mon–Sun headers, ISO week numbers, browse months with arrows). Click days to multi-select; selection persists across months. Existing bookings for the chosen space are highlighted amber with a hover tooltip (foodtruck @ space); already-blocked dates are struck through and unselectable. Save loops `adminCreateSpaceBlockedDate()` once per selected day. Bookings are loaded via `getBookingsForDateRange()` (today → +18 months) when a space is selected.

### Deployment
- Self-hosted on the **`glsfbg` VPS** in Docker behind Caddy (migrated off
  Frej's Vercel 2026-06-18). See `DEPLOY.md` for the full runbook.
- Production URL: `https://foodtruck.businessfalkenberg.se`
- Container `foodtruck`, host `127.0.0.1:3009` → container `:3000`
- **We run on our own fork now — Frej has left.** This repo has two git remotes:
  - `fork` → `cryptonicsurfer/foodtruck` — **our fork; this is what the VPS
    deploys from. Push here** (`git push fork main`).
  - `origin` → `frejandreassen/foodtruck` — Frej's upstream. Diverged (still
    carries his Vercel-deploy GitHub Action); not our deploy source. Don't push
    here — it'll be rejected and wouldn't deploy anyway.
- To deploy changes: `git push fork main`, then
  `ssh -A glsfbg && cd ~/foodtruck && git pull && docker compose up -d --build`
  (the VPS `~/foodtruck` clone tracks `cryptonicsurfer/foodtruck`).
- Frej's old Vercel deploy (`foodtruck-zeta.vercel.app`) is orphaned — no DNS
  points to it, and we no longer maintain that pipeline.

### Environment Variables
- `DIRECTUS_URL` / `NEXT_PUBLIC_DIRECTUS_URL` - Directus backend URL
- `APP_URL` / `NEXT_PUBLIC_APP_URL` - Application URL (for password reset links)
- Google Maps API key (via EnvProvider)

## Code Conventions
- Use `@/` absolute imports
- Use `cn()` utility from `lib/utils.ts` for Tailwind class merging
- Named exports for components
- UI primitives in `/components/ui`, feature components in `/components`
- Server actions return `{ success: boolean, data?: T, error?: string }`

## Gotchas

- **`<Toaster />` must stay mounted in `app/layout.tsx`.** It was historically
  missing (a dead `<div id="toast-container" />` placeholder sat there instead),
  which made **every** `toast()` in the app silently no-op — booking success,
  errors, validation, all invisible. If toasts stop showing, check the layout first.

- **Directus `spaces.location` map widget needs a Caddy CSP exception.** The
  Directus map field uses MapLibre GL, which spawns a `blob:` web worker and
  fetches tile data. The shared `(security_headers)` Caddy snippet has no
  `worker-src blob:` and a locked-down `connect-src`, so the map renders blank
  (controls + attribution show, tiles don't). Fix lives in the VPS
  `/etc/caddy/Caddyfile`: the `cms.businessfalkenberg.se` block has its **own**
  CSP (not `import security_headers`) adding `script-src … blob:`,
  `worker-src 'self' blob:`, and `connect-src … *.tile.openstreetmap.org
  basemaps.cartocdn.com`. Applied via graceful `sudo systemctl reload caddy` (no
  Directus restart, no fleet auth blip). Backup: `~/Caddyfile.bak-mapfix` on the VPS.
  If tiles still fail for a basemap, add that tile host to the cms `connect-src`.

- **Tall dialogs are mis-centered** (Tailwind v4). `components/ui/dialog.tsx` `DialogContent` carries both Tailwind translate utilities (which set the v4 `translate` CSS property) *and* an arbitrary `[transform:translate(-50%,-50%)]`. The two stack to ≈ -100% height, so a dialog near full viewport height gets pushed off the top of the screen. For tall content, override with an inline style that pins it cleanly instead of relying on translate centering — e.g. `style={{ top: "2.5vh", bottom: "2.5vh", maxHeight: "none", height: "auto", translate: "none", transform: "translateX(-50%)" }}` plus `flex flex-col` on the content and `flex-1 min-h-0 overflow-y-auto` on the scrollable middle (see the "Spärra period" dialog in `app/admin/page.tsx`). Important modifiers use the v4 **suffix** form (`flex!`), not the v3 prefix (`!flex`).