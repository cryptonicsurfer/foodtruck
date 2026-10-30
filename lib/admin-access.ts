/**
 * Who counts as foodtruck admin — shared by the server actions and the
 * admin-assistant API routes. Server-only (never imported by client code).
 */
import { directusServer } from "@/lib/directus-server"

const ADMIN_ROLES = ['Administrator', 'Head of Foodtruck']
// "Head of food truck spaces" — the policy behind Head of Foodtruck. Users whose
// role belongs to another app (CRM, Destination) get it attached directly instead.
const FOODTRUCK_ADMIN_POLICY_ID = '4160d6aa-eefe-4d9e-ac2b-c32ac66b83d1'

/**
 * Admin = an admin role, or the foodtruck admin policy attached to the user.
 * Fails closed: if the policy lookup errors, the user is not admin.
 */
export async function hasAdminAccess(token: string, roleName?: string) {
  if (ADMIN_ROLES.includes(roleName || '')) return true
  try {
    const policyIds = await directusServer.getCurrentUserPolicyIds(token)
    return policyIds.includes(FOODTRUCK_ADMIN_POLICY_ID)
  } catch {
    return false
  }
}
