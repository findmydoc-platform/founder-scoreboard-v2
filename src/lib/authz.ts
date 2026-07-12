import type { NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isOperationalLeadRole } from "./platform";
import { getSupabaseForToken, requiresSupabaseAuth } from "./supabase";
import type { AuthenticatedProfile, PlatformRole } from "./types";

type AuthzProfileRow = {
  id: string;
  name: string;
  platform_role: PlatformRole;
  github_login: string | null;
};

export type AuthzResult =
  | { ok: true; profile: AuthenticatedProfile | null }
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

function mapAuthzProfile(profile: AuthzProfileRow): AuthenticatedProfile {
  return {
    id: profile.id,
    name: profile.name,
    platformRole: profile.platform_role,
    githubLogin: profile.github_login || "",
  };
}

type PlatformRoleCheckOptions = {
  devProfileId?: string;
  devProfileOverrideAllowed?: boolean;
};

export async function requirePlatformRoleForUser(
  supabase: SupabaseClient,
  user: User,
  allowedRoles: PlatformRole[],
  options: PlatformRoleCheckOptions = {},
): Promise<AuthzResult> {
  const githubLogin = String(user.user_metadata?.user_name || user.user_metadata?.preferred_username || "");

  const authProfileResult = await supabase
    .from("profiles")
    .select("id,name,platform_role,github_login")
    .eq("auth_user_id", user.id)
    .maybeSingle<AuthzProfileRow>();
  if (authProfileResult.error) return { ok: false, status: 403, error: "Teamprofil konnte nicht eindeutig geprüft werden." };

  let githubProfile: AuthzProfileRow | null = null;
  if (githubLogin) {
    const githubProfileResult = await supabase
      .from("profiles")
      .select("id,name,platform_role,github_login")
      .ilike("github_login", githubLogin)
      .limit(2)
      .returns<AuthzProfileRow[]>();
    if (githubProfileResult.error) return { ok: false, status: 403, error: "GitHub-Profilzuordnung konnte nicht geprüft werden." };
    if ((githubProfileResult.data || []).length > 1) {
      return { ok: false, status: 403, error: "GitHub-Login ist mehreren Teamprofilen zugeordnet." };
    }
    githubProfile = githubProfileResult.data?.[0] || null;
  }

  if (authProfileResult.data && githubProfile && authProfileResult.data.id !== githubProfile.id) {
    return { ok: false, status: 403, error: "Session-Profil und GitHub-Profil verweisen auf unterschiedliche Teamprofile." };
  }

  const profile = authProfileResult.data || githubProfile;
  if (!profile) return { ok: false, status: 403, error: "GitHub-User ist keinem Teamprofil zugeordnet." };
  let effectiveProfile = profile;
  const devProfileId = options.devProfileId?.trim() || "";
  const canUseDevProfile = isOperationalLeadRole(profile.platform_role);

  if (devProfileId && options.devProfileOverrideAllowed && canUseDevProfile) {
    const { data: overrideProfile, error: overrideError } = await supabase
      .from("profiles")
      .select("id,name,platform_role,github_login")
      .eq("id", devProfileId)
      .single<AuthzProfileRow>();

    if (overrideError || !overrideProfile) return { ok: false, status: 403, error: "Dev-Testprofil wurde nicht gefunden." };
    effectiveProfile = overrideProfile;
  }

  if (!allowedRoles.includes(effectiveProfile.platform_role)) {
    return { ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." };
  }

  return {
    ok: true,
    profile: mapAuthzProfile(effectiveProfile),
  };
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

  return requirePlatformRoleForUser(supabase, userResult.user, allowedRoles, {
    devProfileId: request.headers.get("x-fmd-dev-profile-id") || "",
    devProfileOverrideAllowed: devProfileOverrideAllowed(request),
  });
}

export function requirePlanningContributor(request: NextRequest) {
  return requirePlatformRole(request, ["ceo", "founder", "deputy"]);
}

export function requireCEO(request: NextRequest) {
  return requirePlatformRole(request, ["ceo"]);
}

export function requireOperationalLead(request: NextRequest) {
  return requirePlatformRole(request, ["ceo", "deputy"]);
}

export function requireTeamMember(request: NextRequest) {
  return requirePlatformRole(request, ["ceo", "founder", "deputy", "viewer"]);
}

export async function requireTaskReviewer(
  request: NextRequest,
  task: { review_owner_profile_id?: string | null },
  existingPermission?: AuthzResult,
) {
  const permission = existingPermission || await requirePlanningContributor(request);
  if (!permission.ok) return permission;
  if (!requiresSupabaseAuth()) return permission;

  const profile = permission.profile;
  if (!profile) return { ok: false as const, status: 403, error: "GitHub-User ist keinem Teamprofil zugeordnet." };
  if (isOperationalLeadRole(profile.platformRole)) return permission;
  if (task.review_owner_profile_id && task.review_owner_profile_id === profile.id) return permission;

  return {
    ok: false as const,
    status: 403,
    error: "Nur Review Owner, CEO oder Deputy können diese Review finalisieren.",
  };
}
