import { NextResponse, type NextRequest } from "next/server";
import { commitTeamTaskIntake } from "@/features/intake/model/team-task-intake-commit";
import {
  buildTeamTaskIntakePreview,
  loadTeamTaskIntakeContext,
  parseTeamTaskIntakePayload,
  teamTaskIntakePreviewIsValid,
  validateTeamTaskIntakeBatchSize,
} from "@/features/intake/model/team-task-intake";
import { requireTeamTaskIntakeScope } from "@/features/intake/model/team-task-intake-token";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const permission = await requireTeamTaskIntakeScope(request, "write:task-intake");
  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
  if (!uuidPattern.test(idempotencyKey)) {
    return NextResponse.json({ ok: false, error: "Gültiger UUID-Idempotency-Key ist erforderlich." }, { status: 400 });
  }

  const payload = await request.json().catch(() => null);
  const rawTasks = parseTeamTaskIntakePayload(payload);
  const batchError = validateTeamTaskIntakeBatchSize(rawTasks.length);
  if (batchError) return NextResponse.json({ ok: false, error: batchError }, { status: 400 });

  try {
    const context = await loadTeamTaskIntakeContext(permission.supabase, rawTasks);
    const preview = buildTeamTaskIntakePreview(rawTasks, context, permission.profile);
    if (!teamTaskIntakePreviewIsValid(preview)) {
      return NextResponse.json({
        ok: false,
        error: "Team Task Intake enthält ungültige Aufgaben.",
        tasks: preview,
      }, { status: 400 });
    }

    const result = await commitTeamTaskIntake({
      actor: permission.profile,
      context,
      idempotencyKey,
      preview,
      request,
      supabase: permission.supabase,
      tokenId: permission.tokenId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code || "") : "";
    const message = error instanceof Error ? error.message : "Team Task Intake konnte nicht gespeichert werden.";
    if (code === "P0003") return NextResponse.json({ ok: false, error: "Idempotency-Key wurde mit anderen Daten wiederverwendet." }, { status: 409 });
    if (code === "P0004") return NextResponse.json({ ok: false, error: "Team-Intake-Token ist nicht mehr aktiv." }, { status: 401 });
    if (code === "22023") return NextResponse.json({ ok: false, error: "Team-Intake-Batch ist ungültig." }, { status: 400 });
    if (code === "PGRST202" || code === "42P01") return NextResponse.json({ ok: false, error: "Team-Intake-Schema ist noch nicht verfügbar." }, { status: 503 });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
