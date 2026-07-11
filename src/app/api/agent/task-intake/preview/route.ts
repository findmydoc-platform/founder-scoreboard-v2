import { NextRequest, NextResponse } from "next/server";
import { handleAgentRequest } from "@/features/agent/model/agent-route-handler";
import { buildTaskIntakePreviewForRoute, taskIntakePreviewResponse } from "@/features/intake/model/task-intake-route";
import { getServerSupabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  return handleAgentRequest(request, "write:intake", async () => {
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
  });
}
