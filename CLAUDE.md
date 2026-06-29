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
- Google Maps integration via @react-google-maps/api

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

**Provider Hierarchy** (in `app/layout.tsx`):
```
EnvProvider → QueryProvider → AuthProvider → MapsProvider
```

### Directus Schema

**Collections:**
- `foodtrucks` - id, name, user (FK to Directus user), bookings relation
- `spaces` - id, name, location (geographic point), time_slots, bookings relation
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
tab is opened (and re-fetchable with "Uppdatera"). Filters: from-date (default
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

### Admin: blocked dates (`/admin` → "Spärrade datum")

The block-date dialog has two modes via a toggle:
- **Spärra dag** — single date via a native date input → one `adminCreateSpaceBlockedDate()`.
- **Spärra period** — `components/multi-date-calendar.tsx`: a month grid (Mon–Sun headers, ISO week numbers, browse months with arrows). Click days to multi-select; selection persists across months. Existing bookings for the chosen space are highlighted amber with a hover tooltip (foodtruck @ space); already-blocked dates are struck through and unselectable. Save loops `adminCreateSpaceBlockedDate()` once per selected day. Bookings are loaded via `getBookingsForDateRange()` (today → +18 months) when a space is selected.

### Deployment
- Self-hosted on the **`glsfbg` VPS** in Docker behind Caddy (migrated off
  Frej's Vercel 2026-06-18). See `DEPLOY.md` for the full runbook.
- Production URL: `https://foodtruck.businessfalkenberg.se`
- Container `foodtruck`, host `127.0.0.1:3009` → container `:3000`
- Deploys from `cryptonicsurfer/foodtruck` → `main`
- To deploy changes: `ssh -A glsfbg && cd ~/foodtruck && git pull && docker compose up -d --build`
- Old Vercel deploy (`foodtruck-zeta.vercel.app`) is orphaned — no DNS points to it.

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

- **Tall dialogs are mis-centered** (Tailwind v4). `components/ui/dialog.tsx` `DialogContent` carries both Tailwind translate utilities (which set the v4 `translate` CSS property) *and* an arbitrary `[transform:translate(-50%,-50%)]`. The two stack to ≈ -100% height, so a dialog near full viewport height gets pushed off the top of the screen. For tall content, override with an inline style that pins it cleanly instead of relying on translate centering — e.g. `style={{ top: "2.5vh", bottom: "2.5vh", maxHeight: "none", height: "auto", translate: "none", transform: "translateX(-50%)" }}` plus `flex flex-col` on the content and `flex-1 min-h-0 overflow-y-auto` on the scrollable middle (see the "Spärra period" dialog in `app/admin/page.tsx`). Important modifiers use the v4 **suffix** form (`flex!`), not the v3 prefix (`!flex`).