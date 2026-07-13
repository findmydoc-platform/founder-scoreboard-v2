import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { apiError, requireApiContext, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import {
  createTeamPlanningItemsToken,
  mapTeamPlanningItemsTokenRecord,
} from "@/features/planning-items/model/planning-items-token";
import { TEAM_PLANNING_ITEMS_TOKEN_HISTORY_LIMIT } from "@/features/planning-items/model/planning-items-contract";

type CreateTokenPayload = {
  label?: unknown;
  allowUpdates?: unknown;
};

type TokenRecordRow = Parameters<typeof mapTeamPlanningItemsTokenRecord>[0];

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requirePlanningContributor, {
    supabaseUnavailableMessage: "Supabase ist für Planning-API-Tokens erforderlich.",
  });
  if (!context.ok) return context.response;

  const { permission, supabase } = context;
  const profileId = permission.profile?.id || "";
  if (!profileId) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const now = new Date().toISOString();
  const [activeResult, historyResult] = await Promise.all([
    supabase
      .from("team_task_intake_tokens")
      .select("id,label,token_hint,scopes,expires_at,created_at,last_used_at,revoked_at")
      .eq("profile_id", profileId)
      .is("revoked_at", null)
      .gt("expires_at", now)
      .order("created_at", { ascending: false }),
    supabase
      .from("team_task_intake_tokens")
      .select("id,label,token_hint,scopes,expires_at,created_at,last_used_at,revoked_at")
      .eq("profile_id", profileId)
      .or(`revoked_at.not.is.null,expires_at.lte.${now}`)
      .order("created_at", { ascending: false })
      .limit(TEAM_PLANNING_ITEMS_TOKEN_HISTORY_LIMIT),
  ]);
  const error = activeResult.error || historyResult.error;
  if (error) return apiError(error.code === "42P01" ? "Planning-API-Schema ist noch nicht verfügbar." : "Planning-API-Tokens konnten nicht geladen werden.", error.code === "42P01" ? 503 : 500);

  return NextResponse.json({
    ok: true,
    tokens: ([...(activeResult.data || []), ...(historyResult.data || [])] as TokenRecordRow[]).map(mapTeamPlanningItemsTokenRecord),
  });
}

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<CreateTokenPayload>(request, requirePlanningContributor, {}, {
    supabaseUnavailableMessage: "Supabase ist für Planning-API-Tokens erforderlich.",
  });
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  const profileId = permission.profile?.id || "";
  if (!profileId) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const label = cleanText(payload.label, 80);
  if (!label) return apiError("Token-Bezeichnung ist erforderlich.", 400);
  if (payload.allowUpdates !== undefined && typeof payload.allowUpdates !== "boolean") {
    return apiError("allowUpdates muss wahr oder falsch sein.", 400);
  }

  const generated = createTeamPlanningItemsToken();
  const { data, error } = await supabase.rpc("create_team_planning_items_token", {
    p_profile_id: profileId,
    p_label: label,
    p_token_hash: generated.tokenHash,
    p_token_hint: generated.tokenHint,
    p_allow_updates: payload.allowUpdates === true,
  });

  if (error) {
    if (error.code === "P0003") return apiError("Maximal drei aktive Planning-API-Tokens sind erlaubt.", 409);
    if (error.code === "P0002") return apiError("Operatives Profil wurde nicht gefunden.", 403);
    if (error.code === "22023") return apiError("Token-Daten sind ungültig.", 400);
    return apiError(error.code === "PGRST202" || error.code === "42883" ? "Planning-API-Schema ist noch nicht verfügbar." : "Planning-API-Token konnte nicht erstellt werden.", error.code === "PGRST202" || error.code === "42883" ? 503 : 500);
  }

  const tokenRecord = mapTeamPlanningItemsTokenRecord(data as TokenRecordRow);
  return NextResponse.json({
    ok: true,
    token: generated.token,
    tokenRecord,
  });
}
