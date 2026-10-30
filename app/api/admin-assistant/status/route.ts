import { NextResponse } from "next/server"
import { guard } from "@/lib/assistant/guard"

// Admin only (guard): the /admin button asks here whether to show itself
export async function GET(req: Request) {
  const g = await guard(req, "status")
  if (g instanceof NextResponse) return g
  return NextResponse.json({ enabled: true })
}
