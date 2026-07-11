import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { apiError, requireApiContext, requireJsonApiContext } from "@/lib/api-response";
import { requireFounder } from "@/lib/authz";
import {
  createTeamTaskIntakeToken,
  mapTeamTaskIntakeTokenRecord,
} from "@/features/intake/model/team-task-intake-token";

type CreateTokenPayload = {
  label?: unknown;
};

type TokenRecordRow = Parameters<typeof mapTeamTaskIntakeTokenRecord>[0];

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requireFounder, {
    supabaseUnavailableMessage: "Supabase ist für Team-Intake-Tokens erforderlich.",
  });
  if (!context.ok) return context.response;

  const { permission, supabase } = context;
  const profileId = permission.profile?.id || "";
  if (!profileId) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const { data, error } = await supabase
    .from("team_task_intake_tokens")
    .select("id,label,token_hint,scopes,expires_at,created_at,last_used_at,revoked_at")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return apiError(error.message, error.code === "42P01" ? 503 : 500);

  return NextResponse.json({
    ok: true,
    tokens: ((data || []) as TokenRecordRow[]).map(mapTeamTaskIntakeTokenRecord),
  });
}

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<CreateTokenPayload>(request, requireFounder, {}, {
    supabaseUnavailableMessage: "Supabase ist für Team-Intake-Tokens erforderlich.",
  });
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  const profileId = permission.profile?.id || "";
  if (!profileId) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const label = cleanText(payload.label, 80);
  if (!label) return apiError("Token-Bezeichnung ist erforderlich.", 400);

  const generated = createTeamTaskIntakeToken();
  const { data, error } = await supabase.rpc("create_team_task_intake_token", {
    p_profile_id: profileId,
    p_label: label,
    p_token_hash: generated.tokenHash,
    p_token_hint: generated.tokenHint,
    p_expires_at: generated.expiresAt,
  });

  if (error) {
    if (error.code === "P0003") return apiError("Maximal drei aktive Team-Intake-Tokens sind erlaubt.", 409);
    if (error.code === "P0002") return apiError("Operatives Profil wurde nicht gefunden.", 403);
    if (error.code === "22023") return apiError("Token-Daten sind ungültig.", 400);
    return apiError(error.message, error.code === "PGRST202" ? 503 : 500);
  }

  const tokenRecord = mapTeamTaskIntakeTokenRecord(data as TokenRecordRow);
  return NextResponse.json({
    ok: true,
    token: generated.token,
    tokenRecord,
  });
}
