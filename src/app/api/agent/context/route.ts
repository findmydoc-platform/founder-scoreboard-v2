import { NextRequest, NextResponse } from "next/server";

import { requireAgentScope } from "@/lib/agent-auth";
import { buildAgentContext } from "@/lib/agent-data";

export async function GET(request: NextRequest) {
  const permission = requireAgentScope(request, "read:planning");
  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  const { context, source } = await buildAgentContext();
  return NextResponse.json({ ok: true, source, context });
}
