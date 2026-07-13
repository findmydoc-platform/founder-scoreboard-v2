import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { AuthenticatedProfile } from "@/lib/types";
import { getServerSupabase } from "@/lib/supabase";
import type {
  TeamPlanningItemScope,
  TeamPlanningItemTokenRecord,
} from "@/features/planning-items/model/planning-items-contract";

type TokenRow = {
  id: string;
  profile_id: string;
  label: string;
  token_hash: string;
  token_hint: string;
  scopes: TeamPlanningItemScope[] | null;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type AuthenticatedTokenPayload = {
  tokenId: string;
  scopes: TeamPlanningItemScope[];
  profile: AuthenticatedProfile;
};

export type TeamPlanningItemsAuthResult =
  | {
    ok: true;
    supabase: NonNullable<ReturnType<typeof getServerSupabase>>;
    profile: AuthenticatedProfile;
    tokenId: string;
    scopes: TeamPlanningItemScope[];
  }
  | { ok: false; status: 401 | 403 | 500 | 501 | 503; error: string };

const tokenPrefix = "fmd_ti_";

function bearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

export function hashTeamPlanningItemsToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createTeamPlanningItemsToken() {
  const token = `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashTeamPlanningItemsToken(token),
    tokenHint: `…${token.slice(-6)}`,
  };
}

export function mapTeamPlanningItemsTokenRecord(
  row: Omit<TokenRow, "token_hash" | "profile_id">,
): TeamPlanningItemTokenRecord {
  return {
    id: row.id,
    label: row.label,
    tokenHint: row.token_hint,
    scopes: row.scopes || [],
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at || "",
    revokedAt: row.revoked_at || "",
  };
}

export async function requireTeamPlanningItemScope(
  request: NextRequest,
  scope: TeamPlanningItemScope,
): Promise<TeamPlanningItemsAuthResult> {
  const supabase = getServerSupabase();
  if (!supabase) return { ok: false, status: 501, error: "Supabase ist für die Team-Planungs-API erforderlich." };

  const token = bearerToken(request);
  if (!token.startsWith(tokenPrefix)) return { ok: false, status: 401, error: "Planning-API-Token ist erforderlich." };

  const tokenHash = hashTeamPlanningItemsToken(token);
  const { data, error } = await supabase.rpc("authenticate_team_planning_items_token", {
    p_token_hash: tokenHash,
    p_scope: scope,
  });

  if (error?.code === "P0004") return { ok: false, status: 401, error: "Planning-API-Token ist ungültig oder abgelaufen." };
  if (error?.code === "P0005") return { ok: false, status: 403, error: "Planning-API-Token hat nicht den erforderlichen Scope." };
  if (error?.code === "P0006") return { ok: false, status: 403, error: "Planning-API-Token ist keinem operativen FounderOps-Profil zugeordnet." };
  if (error?.code === "PGRST202" || error?.code === "42883") {
    return { ok: false, status: 503, error: "Planning-API-Schema ist noch nicht verfügbar." };
  }
  if (error) return { ok: false, status: 500, error: "Planning-API-Token konnte nicht geprüft werden." };

  const authenticated = data as AuthenticatedTokenPayload | null;
  if (!authenticated?.tokenId || !authenticated.profile) {
    return { ok: false, status: 401, error: "Planning-API-Token ist ungültig oder abgelaufen." };
  }

  return {
    ok: true,
    supabase,
    tokenId: authenticated.tokenId,
    scopes: authenticated.scopes,
    profile: authenticated.profile,
  };
}
