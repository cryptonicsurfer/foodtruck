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

**Key Relationships:**
- Food truck owners (Directus users) have one food truck
- Food trucks and spaces have many bookings
- Each booking links one food truck to one space for a time period

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