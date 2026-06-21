import { NextRequest, NextResponse } from "next/server";

import { requireAgentScope } from "@/lib/agent-auth";
import { getServerSupabase } from "@/lib/supabase";
import { commitTaskIntake } from "@/lib/task-intake-commit";
import { buildTaskIntakePreviewForRoute } from "@/lib/task-intake-route";

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

  const { context, preview } = intake;
  const invalid = preview.filter((task) => task.errors.length > 0);
  if (invalid.length) {
    return NextResponse.json(
      { ok: false, error: "Agent Task Intake enthält ungültige Aufgaben.", tasks: preview },
      { status: 400 },
    );
  }

  const tasks = await commitTaskIntake({
    supabase,
    request,
    context,
    preview,
    actorProfileId: await loadCeoActorProfileId(supabase),
    auditAction: "agent.task_intake.create",
    activitySource: "Agent API",
  });

  return NextResponse.json({ ok: true, tasks });
}
