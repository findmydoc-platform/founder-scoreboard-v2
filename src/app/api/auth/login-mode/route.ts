import { NextResponse } from "next/server";
import { workspaceAccessContext } from "@/lib/workspace-access";
export async function GET() {
  try {
    if (process.env.VERCEL_ENV === "preview") return NextResponse.json({ mode: "unavailable" }, { headers: { "Cache-Control": "no-store" } });
    const { mode } = await workspaceAccessContext();
    return NextResponse.json({ mode }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ mode: "unavailable" }, { status: 503 }); }
}
