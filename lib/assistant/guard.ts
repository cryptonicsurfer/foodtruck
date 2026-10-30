/**
 * Every admin-assistant route starts with guard(): kill switch → same-origin → logged
 * in → foodtruck admin (Head of Foodtruck / Administrator) → per-user rate limit.
 * Deny by default: a route that skips this is a bug.
 */
import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { directusServer } from "@/lib/directus-server"
import { hasAdminAccess } from "@/lib/admin-access"
import { serverEnv } from "@/lib/env"

export type Admin = { token: string; userId: string }

export function assistantEnabled(): boolean {
  return process.env.ASSISTANT_ENABLED === "1"
}

const deny = (status: number, error: string) => NextResponse.json({ error }, { status })

/** Same-origin only: blocks cross-site POSTs riding on the session cookie (CSRF). */
function sameOrigin(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site")
  if (site) return site === "same-origin"
  const origin = req.headers.get("origin")
  if (!origin) return req.method === "GET"
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  try {
    const o = new URL(origin)
    return o.host === host || o.origin === new URL(serverEnv.APP_URL).origin
  } catch {
    return false
  }
}

const hits = new Map<string, number[]>()

/** Sliding one-hour window per user and bucket. In memory: one container, restarts reset it. */
function rateLimited(key: string, perHour: number): boolean {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3600_000)
  if (recent.length >= perHour) {
    hits.set(key, recent)
    return true
  }
  recent.push(now)
  hits.set(key, recent)
  return false
}

export async function guard(req: Request, bucket: "chat" | "confirm" | "status"): Promise<Admin | NextResponse> {
  // Off → the feature doesn't exist (404, not 403)
  if (!assistantEnabled()) return deny(404, "Not found")
  if (!sameOrigin(req)) return deny(403, "Forbidden")
  const jar = await cookies()
  let token = jar.get("access_token")?.value
  if (!token && !jar.get("refresh_token")) return deny(401, "Inte inloggad")
  let me: Awaited<ReturnType<typeof directusServer.getCurrentUserWithRole>> | null = null
  try {
    if (token) me = await directusServer.getCurrentUserWithRole(token)
  } catch {
    me = null
  }
  // The access token lives ~15 min; a chat can last longer. Renew once with the refresh token.
  if (!me) {
    token = await renew()
    if (!token) return deny(401, "Inloggningen har gått ut. Ladda om sidan och logga in igen.")
    try {
      me = await directusServer.getCurrentUserWithRole(token)
    } catch {
      return deny(401, "Inloggningen har gått ut. Ladda om sidan och logga in igen.")
    }
  }
  const userId = me.data.id
  if (!(await hasAdminAccess(token!, me.data.role?.name))) return deny(403, "Bara för Head of Foodtruck")
  const limits = { chat: 30, confirm: 60, status: 120 }
  if (rateLimited(`${bucket}:${userId}`, limits[bucket])) {
    return deny(429, "Du har använt assistenten mycket den senaste timmen. Vänta en stund.")
  }
  return { token: token!, userId }
}

/** Same cookies as the refreshToken server action in app/actions.ts. */
async function renew(): Promise<string | undefined> {
  const jar = await cookies()
  const refresh = jar.get("refresh_token")?.value
  if (!refresh) return undefined
  try {
    const { data } = await directusServer.refreshToken(refresh)
    const opts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge: 60 * 60 }
    jar.set("access_token", data.access_token, opts)
    jar.set("refresh_token", data.refresh_token, opts)
    return data.access_token
  } catch {
    return undefined
  }
}
