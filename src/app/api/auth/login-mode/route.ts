import { NextResponse } from "next/server";
import { workspaceAccessContext } from "@/lib/workspace-access";
export async function GET() {
  try {
    const { mode, linkingEnforced } = await workspaceAccessContext();
    return NextResponse.json({ mode, linkingEnforced }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ mode: "unavailable" }, { status: 503 }); }
}
