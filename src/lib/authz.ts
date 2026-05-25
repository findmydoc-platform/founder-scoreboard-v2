import type { NextRequest } from "next/server";
import { getSupabaseForToken, requiresSupabaseAuth } from "./supabase";
import type { PlatformRole, Profile } from "./types";

export type AuthzResult =
  | { ok: true; profile: Pick<Profile, "id" | "name" | "platformRole" | "githubLogin"> | null }
  | { ok: false; status: number; error: string };

export function bearerToken(request: NextRequest) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length).trim();
}

export async function requirePlatformRole(
  request: NextRequest,
  allowedRoles: PlatformRole[],
): Promise<AuthzResult> {
  if (!requiresSupabaseAuth()) return { ok: true, profile: null };

  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return { ok: false, status: 401, error: "Anmeldung erforderlich." };

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) return { ok: false, status: 401, error: "Anmeldung ungültig oder abgelaufen." };

  const githubLogin = String(userResult.user.user_metadata?.user_name || userResult.user.user_metadata?.preferred_username || "");

  const profileQuery = supabase
    .from("profiles")
    .select("id,name,platform_role,github_login")
    .or(`auth_user_id.eq.${userResult.user.id}${githubLogin ? `,github_login.eq.${githubLogin}` : ""}`)
    .limit(1)
    .single();

  const { data: profile, error: profileError } = await profileQuery;
  if (profileError || !profile) return { ok: false, status: 403, error: "GitHub-User ist keinem Teamprofil zugeordnet." };

  if (!allowedRoles.includes(profile.platform_role)) {
    return { ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." };
  }

  return {
    ok: true,
    profile: {
      id: profile.id,
      name: profile.name,
      platformRole: profile.platform_role,
      githubLogin: profile.github_login || "",
    },
  };
}

export function requireFounder(request: NextRequest) {
  return requirePlatformRole(request, ["ceo", "founder", "deputy"]);
}

export function requireCEO(request: NextRequest) {
  return requirePlatformRole(request, ["ceo"]);
}

export function requireOperationalLead(request: NextRequest) {
  return requirePlatformRole(request, ["ceo", "deputy"]);
}
