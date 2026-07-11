import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import type { AuthenticatedProfile, PlatformRole } from "@/lib/types";
import { getServerSupabase } from "@/lib/supabase";

export type TeamTaskIntakeScope = "read:task-context" | "write:task-intake";

export type TeamTaskIntakeTokenRecord = {
  id: string;
  label: string;
  tokenHint: string;
  scopes: TeamTaskIntakeScope[];
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string;
};

type TokenProfileRow = {
  id: string;
  name: string;
  platform_role: PlatformRole;
  github_login: string | null;
};

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
  profiles: TokenProfileRow | TokenProfileRow[] | null;
};

export type TeamTaskIntakeAuthResult =
  | {
    ok: true;
    supabase: NonNullable<ReturnType<typeof getServerSupabase>>;
    profile: AuthenticatedProfile;
    tokenId: string;
    scopes: TeamTaskIntakeScope[];
  }
  | { ok: false; status: 401 | 403 | 500 | 501; error: string };

const tokenPrefix = "fmd_ti_";
const allowedRoles = new Set<PlatformRole>(["ceo", "deputy", "founder"]);

function bearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

export function hashTeamTaskIntakeToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function safeHashCompare(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function profileFromTokenRow(row: TokenRow) {
  if (Array.isArray(row.profiles)) return row.profiles[0] || null;
  return row.profiles;
}

export function createTeamTaskIntakeToken(now = new Date()) {
  const token = `${tokenPrefix}${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
  return {
    token,
    tokenHash: hashTeamTaskIntakeToken(token),
    tokenHint: `…${token.slice(-6)}`,
    expiresAt,
  };
}

export function mapTeamTaskIntakeTokenRecord(row: Omit<TokenRow, "token_hash" | "profiles" | "profile_id">): TeamTaskIntakeTokenRecord {
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
  const { data, error } = await supabase
    .from("team_task_intake_tokens")
    .select("id,profile_id,label,token_hash,token_hint,scopes,expires_at,created_at,last_used_at,revoked_at,profiles(id,name,platform_role,github_login)")
    .eq("token_hash", tokenHash)
    .maybeSingle<TokenRow>();

  if (error) return { ok: false, status: 500, error: "Team-Intake-Token konnte nicht geprüft werden." };
  if (!data || data.revoked_at || Date.parse(data.expires_at) <= Date.now() || !safeHashCompare(data.token_hash, tokenHash)) {
    return { ok: false, status: 401, error: "Team-Intake-Token ist ungültig oder abgelaufen." };
  }

  const scopes = data.scopes || [];
  if (!scopes.includes(scope)) return { ok: false, status: 403, error: "Team-Intake-Token hat nicht den erforderlichen Scope." };

  const profile = profileFromTokenRow(data);
  if (!profile || !allowedRoles.has(profile.platform_role)) {
    return { ok: false, status: 403, error: "Team-Intake-Token ist keinem operativen FounderOps-Profil zugeordnet." };
  }

  const { error: usageError } = await supabase
    .from("team_task_intake_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .eq("profile_id", profile.id);
  if (usageError) return { ok: false, status: 500, error: "Token-Nutzung konnte nicht protokolliert werden." };

  return {
    ok: true,
    supabase,
    tokenId: data.id,
    scopes,
    profile: {
      id: profile.id,
      name: profile.name,
      platformRole: profile.platform_role,
      githubLogin: profile.github_login || "",
    },
  };
}
