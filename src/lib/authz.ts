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

function devProfileOverrideAllowed(request: NextRequest) {
  if (process.env.NODE_ENV === "production") return false;
  const host = request.headers.get("host") || "";
  return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host);
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
  let effectiveProfile = profile;
  const devProfileId = request.headers.get("x-fmd-dev-profile-id")?.trim() || "";
  const canUseDevProfile = profile.platform_role === "ceo" || profile.platform_role === "deputy";

  if (devProfileId && devProfileOverrideAllowed(request) && canUseDevProfile) {
    const { data: overrideProfile, error: overrideError } = await supabase
      .from("profiles")
      .select("id,name,platform_role,github_login")
      .eq("id", devProfileId)
      .single();

    if (overrideError || !overrideProfile) return { ok: false, status: 403, error: "Dev-Testprofil wurde nicht gefunden." };
    effectiveProfile = overrideProfile;
  }

  if (!allowedRoles.includes(effectiveProfile.platform_role)) {
    return { ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." };
  }

  return {
    ok: true,
    profile: {
      id: effectiveProfile.id,
      name: effectiveProfile.name,
      platformRole: effectiveProfile.platform_role,
      githubLogin: effectiveProfile.github_login || "",
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
