import { NextRequest, NextResponse } from "next/server";

import { requireAgentScope } from "@/lib/agent-auth";
import { buildAgentContext } from "@/lib/agent-data";
import { isPlanningDataUnavailableError } from "@/lib/planning-data-availability";

export async function GET(request: NextRequest) {
  const permission = requireAgentScope(request, "read:planning");
  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  try {
    const { context, source } = await buildAgentContext();
    return NextResponse.json({ ok: true, source, context });
  } catch (error) {
    if (isPlanningDataUnavailableError(error)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    throw error;
  }
}
