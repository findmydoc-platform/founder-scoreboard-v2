import { NextResponse, type NextRequest } from "next/server";
import { buildTeamTaskContext } from "@/features/intake/model/team-task-context";
import { requireTeamTaskIntakeScope } from "@/features/intake/model/team-task-intake-token";

export async function GET(request: NextRequest) {
  const permission = await requireTeamTaskIntakeScope(request, "read:task-context");
  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  try {
    const context = await buildTeamTaskContext(permission.supabase, permission.profile);
    return NextResponse.json({ ok: true, context });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Team-Task-Kontext konnte nicht geladen werden.",
    }, { status: 500 });
  }
}
