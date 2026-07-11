import { NextResponse, type NextRequest } from "next/server";
import {
  buildTeamTaskIntakePreview,
  loadTeamTaskIntakeContext,
  parseTeamTaskIntakePayload,
  teamTaskIntakePreviewIsValid,
  validateTeamTaskIntakeBatchSize,
} from "@/features/intake/model/team-task-intake";
import { requireTeamTaskIntakeScope } from "@/features/intake/model/team-task-intake-token";

export async function POST(request: NextRequest) {
  const permission = await requireTeamTaskIntakeScope(request, "write:task-intake");
  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  const payload = await request.json().catch(() => null);
  const rawTasks = parseTeamTaskIntakePayload(payload);
  const batchError = validateTeamTaskIntakeBatchSize(rawTasks.length);
  if (batchError) return NextResponse.json({ ok: false, error: batchError }, { status: 400 });

  try {
    const context = await loadTeamTaskIntakeContext(permission.supabase, rawTasks);
    const preview = buildTeamTaskIntakePreview(rawTasks, context, permission.profile);
    return NextResponse.json({
      ok: true,
      valid: teamTaskIntakePreviewIsValid(preview),
      tasks: preview,
    });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Team Task Intake konnte nicht geprüft werden.",
    }, { status: 500 });
  }
}
