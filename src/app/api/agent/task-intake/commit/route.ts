import { NextRequest, NextResponse } from "next/server";
import { handleAgentRequest } from "@/features/agent/model/agent-route-handler";
import { commitTaskIntake } from "@/features/intake/model/task-intake-commit";
import { buildValidTaskIntakeForRoute, invalidTaskIntakeResponse } from "@/features/intake/model/task-intake-route";
import { getServerSupabase } from "@/lib/supabase";

async function loadCeoActorProfileId(supabase: NonNullable<ReturnType<typeof getServerSupabase>>) {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("platform_role", "ceo")
    .limit(1)
    .maybeSingle();
  return data?.id || null;
}

export async function POST(request: NextRequest) {
  return handleAgentRequest(request, "write:intake", async () => {
    const supabase = getServerSupabase();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is required for Agent Task Intake." }, { status: 501 });
    }

    const intake = await buildValidTaskIntakeForRoute({
      supabase,
      payload: await request.json().catch(() => null),
      emptyMessage: "Keine Aufgaben im Payload gefunden.",
      trimParentTaskIds: false,
      invalidMessage: "Agent Task Intake enthält ungültige Aufgaben.",
    });
    if (!intake.ok) {
      return "preview" in intake && intake.preview
        ? invalidTaskIntakeResponse(intake.error, intake.preview)
        : NextResponse.json({ ok: false, error: intake.error }, { status: intake.status });
    }

    const { context, preview } = intake;
    const tasks = await commitTaskIntake({
      supabase,
      request,
      context,
      preview,
      actorProfileId: await loadCeoActorProfileId(supabase),
      auditAction: "agent.task_intake.create",
      auditSource: "Agent API",
    });

    return NextResponse.json({ ok: true, tasks });
  });
}
