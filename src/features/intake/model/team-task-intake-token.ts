import { createHash, randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import type { AuthenticatedProfile } from "@/lib/types";
import { getServerSupabase } from "@/lib/supabase";
import type { TeamTaskIntakeScope, TeamTaskIntakeTokenRecord } from "@/features/intake/model/team-task-intake-contract";

type TokenRow = {
  id: string;
  profile_id: string;
  label: string;
  token_hash: string;
  token_hint: string;
  scopes: TeamTaskIntakeScope[] | null;
  expires_at: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

type AuthenticatedTokenPayload = {
  tokenId: string;
  scopes: TeamTaskIntakeScope[];
  profile: AuthenticatedProfile;
};

export type TeamTaskIntakeAuthResult =
  | {
    ok: true;
    supabase: NonNullable<ReturnType<typeof getServerSupabase>>;
    profile: AuthenticatedProfile;
    tokenId: string;
    scopes: TeamTaskIntakeScope[];
  }
  | { ok: false; status: 401 | 403 | 500 | 501 | 503; error: string };

const tokenPrefix = "fmd_ti_";

function bearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

export function hashTeamTaskIntakeToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createTeamTaskIntakeToken() {
  const token = `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
  return {
    token,
    tokenHash: hashTeamTaskIntakeToken(token),
    tokenHint: `…${token.slice(-6)}`,
  };
}

export function mapTeamTaskIntakeTokenRecord(row: Omit<TokenRow, "token_hash" | "profile_id">): TeamTaskIntakeTokenRecord {
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

export async function requireTeamTaskIntakeScope(
  request: NextRequest,
  scope: TeamTaskIntakeScope,
): Promise<TeamTaskIntakeAuthResult> {
  const supabase = getServerSupabase();
  if (!supabase) return { ok: false, status: 501, error: "Supabase ist für Team Task Intake erforderlich." };

  const token = bearerToken(request);
  if (!token.startsWith(tokenPrefix)) return { ok: false, status: 401, error: "Team-Intake-Token ist erforderlich." };

  const tokenHash = hashTeamTaskIntakeToken(token);
  const { data, error } = await supabase.rpc("authenticate_team_task_intake_token", {
    p_token_hash: tokenHash,
    p_scope: scope,
  });

  if (error?.code === "P0004") return { ok: false, status: 401, error: "Team-Intake-Token ist ungültig oder abgelaufen." };
  if (error?.code === "P0005") return { ok: false, status: 403, error: "Team-Intake-Token hat nicht den erforderlichen Scope." };
  if (error?.code === "P0006") return { ok: false, status: 403, error: "Team-Intake-Token ist keinem operativen FounderOps-Profil zugeordnet." };
  if (error?.code === "PGRST202" || error?.code === "42883") {
    return { ok: false, status: 503, error: "Team-Intake-Schema ist noch nicht verfügbar." };
  }
  if (error) return { ok: false, status: 500, error: "Team-Intake-Token konnte nicht geprüft werden." };

  const authenticated = data as AuthenticatedTokenPayload | null;
  if (!authenticated?.tokenId || !authenticated.profile) {
    return { ok: false, status: 401, error: "Team-Intake-Token ist ungültig oder abgelaufen." };
  }

  return {
    ok: true,
    supabase,
    tokenId: authenticated.tokenId,
    scopes: authenticated.scopes,
    profile: authenticated.profile,
  };
}
