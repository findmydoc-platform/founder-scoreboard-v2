import { NextRequest, NextResponse } from "next/server";

import { requireAgentScope } from "@/lib/agent-auth";
import { getServerSupabase } from "@/lib/supabase";
import { buildTaskIntakePreviewForRoute, taskIntakePreviewResponse } from "@/lib/task-intake-route";

export async function POST(request: NextRequest) {
  const permission = requireAgentScope(request, "write:intake");
  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase is required for Agent Task Intake." }, { status: 501 });
  }

  const intake = await buildTaskIntakePreviewForRoute({
    supabase,
    payload: await request.json().catch(() => null),
    emptyMessage: "Keine Aufgaben im Payload gefunden.",
    trimParentTaskIds: false,
  });
  if (!intake.ok) return NextResponse.json({ ok: false, error: intake.error }, { status: intake.status });

  return taskIntakePreviewResponse(intake.preview);
}
