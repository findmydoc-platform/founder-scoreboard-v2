import "server-only";
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import type { AuthenticatedProfile } from "@/lib/types";
import { getServerSupabase } from "@/lib/supabase";
import { authorizePersonalTokenWorkspace } from "./workspace";
import { WorkspaceAccessError } from "@/lib/workspace-identity";
import { TEAM_PLANNING_ITEM_SCOPES, type TeamPlanningItemScope } from "@/features/planning-items/model/planning-items-contract";
const tokenPrefix = "fmd_ti_";
function bearerToken(request: NextRequest) {
  return (request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}
function hashTeamPlanningItemsToken(token: string) { return createHash("sha256").update(token, "utf8").digest("hex"); }
type AuthenticatedTokenPayload = {
  tokenId: string;
  tokenHint: string;
  scopes: TeamPlanningItemScope[];
  scopeGranted: boolean;
  expiresAt: string;
  evaluatedAt: string;
  remainingSeconds: number;
  profile: AuthenticatedProfile;
};

export type TeamPlanningItemsAuthErrorCode =
  | "TOKEN_REQUIRED"
  | "TOKEN_INACTIVE"
  | "INSUFFICIENT_SCOPE"
  | "TOKEN_PROFILE_FORBIDDEN"
  | "AUTHORIZATION_UNAVAILABLE";

export type TeamPlanningItemsAuthResult =
  | {
    ok: true;
    supabase: NonNullable<ReturnType<typeof getServerSupabase>>;
    profile: AuthenticatedProfile;
    tokenId: string;
    tokenHint: string;
    scopes: TeamPlanningItemScope[];
    scopeGranted: boolean;
    expiresAt: string;
    evaluatedAt: string;
    remainingSeconds: number;
  }
  | {
    ok: false;
    status: 401 | 403 | 500 | 501 | 503;
    code: TeamPlanningItemsAuthErrorCode;
    error: string;
  };

export async function requireTeamPlanningItemScope(
  request: NextRequest,
  scope: TeamPlanningItemScope,
): Promise<TeamPlanningItemsAuthResult> {
  const startedAt = Date.now();
  const supabase = getServerSupabase();
  if (!supabase) {
    return {
      ok: false,
      status: 501,
      code: "AUTHORIZATION_UNAVAILABLE",
      error: "Supabase ist für die Team-Planungs-API erforderlich.",
    };
  }

  const token = bearerToken(request);
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "TOKEN_REQUIRED",
      error: "Planning-API-Token ist erforderlich.",
    };
  }
  if (!token.startsWith(tokenPrefix)) {
    return {
      ok: false,
      status: 401,
      code: "TOKEN_INACTIVE",
      error: "Planning-API-Token ist ungültig oder abgelaufen.",
    };
  }

  const tokenHash = hashTeamPlanningItemsToken(token);
  const { data, error } = await supabase.rpc("authenticate_team_planning_items_token", {
    p_token_hash: tokenHash,
    p_scope: scope,
  });

  if (error?.code === "P0004") {
    return {
      ok: false,
      status: 401,
      code: "TOKEN_INACTIVE",
      error: "Planning-API-Token ist ungültig oder abgelaufen.",
    };
  }
  if (error?.code === "P0005") {
    return {
      ok: false,
      status: 403,
      code: "INSUFFICIENT_SCOPE",
      error: "Planning-API-Token hat nicht den erforderlichen Scope.",
    };
  }
  if (error?.code === "P0006") {
    return {
      ok: false,
      status: 403,
      code: "TOKEN_PROFILE_FORBIDDEN",
      error: "Planning-API-Token ist keinem operativen FounderOps-Profil zugeordnet.",
    };
  }
  if (error?.code === "PGRST202" || error?.code === "42883") {
    return {
      ok: false,
      status: 503,
      code: "AUTHORIZATION_UNAVAILABLE",
      error: "Planning-API-Schema ist noch nicht verfügbar.",
    };
  }
  if (error) {
    return {
      ok: false,
      status: 500,
      code: "AUTHORIZATION_UNAVAILABLE",
      error: "Planning-API-Token konnte nicht geprüft werden.",
    };
  }

  const authenticated = data as AuthenticatedTokenPayload | null;
  if (
    !authenticated?.tokenId
    || !authenticated.tokenHint
    || !authenticated.profile
    || !Array.isArray(authenticated.scopes)
    || authenticated.scopes.some((grantedScope) => !TEAM_PLANNING_ITEM_SCOPES.includes(grantedScope))
    || typeof authenticated.scopeGranted !== "boolean"
    || !authenticated.expiresAt
    || !authenticated.evaluatedAt
    || !Number.isFinite(Date.parse(authenticated.expiresAt))
    || !Number.isFinite(Date.parse(authenticated.evaluatedAt))
    || !Number.isFinite(authenticated.remainingSeconds)
  ) {
    return {
      ok: false,
      status: 500,
      code: "AUTHORIZATION_UNAVAILABLE",
      error: "Planning-API-Token konnte nicht geprüft werden.",
    };
  }

  const expired = () => Date.now() >= Date.parse(authenticated.expiresAt);
  const inactive = () => ({ ok: false as const, status: 401 as const, code: "TOKEN_INACTIVE" as const, error: "Planning-API-Token ist ungültig oder abgelaufen." });
  if (expired()) return inactive();

  try { await authorizePersonalTokenWorkspace(supabase, authenticated.profile.id, tokenHash, scope, authenticated.scopes, startedAt, Date.parse(authenticated.expiresAt)); }
  catch (error) {
    if (expired()) return inactive();
    return { ok: false, status: error instanceof WorkspaceAccessError ? error.status : 503, code: "AUTHORIZATION_UNAVAILABLE", error: "Workspace-Zugang des Token-Inhabers ist nicht freigegeben." };
  }

  if (expired()) return inactive();
  return {
    ok: true,
    supabase,
    tokenId: authenticated.tokenId,
    tokenHint: authenticated.tokenHint,
    scopes: authenticated.scopes,
    scopeGranted: authenticated.scopeGranted,
    expiresAt: authenticated.expiresAt,
    evaluatedAt: authenticated.evaluatedAt,
    remainingSeconds: Math.max(0, Math.floor(authenticated.remainingSeconds)),
    profile: authenticated.profile,
  };
}
