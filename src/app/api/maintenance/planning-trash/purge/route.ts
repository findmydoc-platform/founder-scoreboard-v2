import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";
import { parsePlanningTrashPurgeResult } from "@/lib/planning-trash-maintenance-result.mjs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "maintenance-request", request }, action: "maintenance.planning-trash.purge" });
  if (!permission.ok) return apiError(permission.error, permission.status);
  const { data, error } = await permission.planningTrash.purge();
  if (error) return apiError("Planungspapierkorb konnte nicht bereinigt werden.", 500);

  const result = parsePlanningTrashPurgeResult(data);
  if (!result) return apiError("Planungspapierkorb lieferte ein ungültiges Bereinigungsergebnis.", 500);

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
