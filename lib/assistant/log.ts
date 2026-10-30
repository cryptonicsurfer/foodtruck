/**
 * The assistant's log (`foodtruck_assistant_actions`), written ONLY by the server with
 * the service account `foodtruck.agent@falkenberg.se` (ASSISTANT_DIRECTUS_TOKEN). That
 * account can create/read/update this one collection and nothing else; users have no
 * permissions on it, so they can't forge or edit rows. The change itself always runs
 * with the user's own token, so Directus' activity log shows who did it.
 */
import { serverEnv } from "@/lib/env"
import type { Card, Proposal } from "./impact"

const COLLECTION = "foodtruck_assistant_actions"
export const PROPOSAL_TTL_MS = 10 * 60 * 1000

export type LogStatus = "pending" | "confirming" | "executed" | "failed" | "cancelled" | "expired"

export type LogRow = {
  id: string
  user: string
  prompt: string
  proposal: Proposal
  card: Card
  status: LogStatus
  date_created: string
  executed_at?: string | null
  result?: unknown
}

function serviceToken(): string {
  const t = process.env.ASSISTANT_DIRECTUS_TOKEN
  if (!t) throw new Error("ASSISTANT_DIRECTUS_TOKEN saknas")
  return t
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${serverEnv.DIRECTUS_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceToken()}`, ...(init.headers ?? {}) },
    cache: "no-store",
  })
  if (!res.ok) throw new Error(`Loggen svarade ${res.status}`)
  return res.status === 204 ? (undefined as T) : ((await res.json()) as { data: T }).data
}

export async function logProposal(row: { user: string; prompt: string; proposal: Proposal; card: Card }): Promise<string> {
  const created = await req<{ id: string }>(`/items/${COLLECTION}?fields=id`, {
    method: "POST",
    body: JSON.stringify({ ...row, status: "pending" }),
  })
  return created.id
}

export async function getLogRow(id: string): Promise<LogRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  try {
    return await req<LogRow>(`/items/${COLLECTION}/${id}`)
  } catch {
    return null
  }
}

/**
 * Move a row from `pending` to `to`. Returns false if it was already taken.
 * NOT atomic on its own: Directus' update-by-query reads the matching keys and then
 * updates them, so concurrent calls can both "win" (tested on staging 2026-10-30: up to
 * 7 of 20 parallel claims succeeded). Callers that execute something must hold
 * withRowLock() around claim + execute.
 */
export async function claimRow(id: string, to: LogStatus): Promise<boolean> {
  const updated = await req<{ id: string }[]>(`/items/${COLLECTION}?fields=id`, {
    method: "PATCH",
    body: JSON.stringify({ query: { filter: { id: { _eq: id }, status: { _eq: "pending" } } }, data: { status: to } }),
  })
  return Array.isArray(updated) && updated.length === 1
}

export async function finishRow(id: string, status: LogStatus, result: unknown): Promise<void> {
  await req(`/items/${COLLECTION}/${id}?fields=id`, {
    method: "PATCH",
    body: JSON.stringify({ status, result, executed_at: new Date().toISOString() }),
  })
}

// One Node process serves the app (one container), so an in-process lock per row is
// enough to stop a double click or two tabs from running a proposal twice. If the app
// is ever scaled to several instances, this needs a database-level lock instead.
const locks = new Set<string>()

export async function withRowLock<T>(id: string, fn: () => Promise<T>): Promise<T | "busy"> {
  if (locks.has(id)) return "busy"
  locks.add(id)
  try {
    return await fn()
  } finally {
    locks.delete(id)
  }
}
