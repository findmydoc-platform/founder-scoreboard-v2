import type { NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isLocalLoginRequestAllowed } from "./local-development-auth";
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
  return isLocalLoginRequestAllowed(request.headers.get("host") || "");
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
  const authProfileResult = await supabase
    .from("profiles")
    .select("id,name,platform_role,github_login")
    .eq("auth_user_id", user.id)
    .maybeSingle<AuthzProfileRow>();
  if (authProfileResult.error) return { ok: false, status: 403, error: "Teamprofil konnte nicht eindeutig geprüft werden." };

  const profile = authProfileResult.data;
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
