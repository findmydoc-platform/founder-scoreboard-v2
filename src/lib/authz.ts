import type { NextRequest } from "next/server";
import { isAuthRetryableFetchError, type SupabaseClient, type User } from "@supabase/supabase-js";
import {
  administratorAccessExpiredErrorCode,
  administratorAccessRequiredErrorCode,
  invalidSessionBeforeEffectErrorCode,
  type AuthErrorCode,
} from "./auth-error-contract";
import {
  inactiveAdministratorAccess,
  sessionAuthority,
  type AdministratorAccessSnapshot,
  type SessionAuthorityContext,
} from "@/features/administrator-access/model/administrator-access";
import { isLocalLoginRequestAllowed } from "./local-development-auth";
import { isOperationalLeadRole } from "./platform";
import { getSupabaseForToken, requiresSupabaseAuth } from "./supabase";
import type { AuthenticatedProfile, PlatformRole } from "./types";

type AuthzProfileRow = {
  id: string;
  name: string;
  platform_role: PlatformRole;
  github_login?: string | null;
};

type AuthzFailure = { ok: false; status: number; error: string; code?: AuthErrorCode };

export type AuthzResult =
  | { ok: true; profile: AuthenticatedProfile | null; authority?: SessionAuthorityContext }
  | AuthzFailure;

export type SessionAuthzResult =
  | { ok: true; user: User; profile: AuthenticatedProfile | null }
  | (AuthzFailure & { user: User | null });

type PlatformRoleCheckOptions = {
  devProfileId?: string;
  devProfileOverrideAllowed?: boolean;
};

const planningContributorRoles: readonly PlatformRole[] = ["ceo", "founder", "deputy"];
const ceoRoles: readonly PlatformRole[] = ["ceo"];
const operationalLeadRoles: readonly PlatformRole[] = ["ceo", "deputy"];
const teamMemberRoles: readonly PlatformRole[] = ["ceo", "founder", "deputy", "viewer"];

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
    githubLogin: "",
  };
}

async function authenticateUser(supabase: SupabaseClient): Promise<{ ok: true; user: User } | AuthzFailure> {
  try {
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (isAuthRetryableFetchError(userError)) {
      return { ok: false, status: 503, error: "Anmeldung konnte vorübergehend nicht geprüft werden." };
    }
    if (userError || !userResult.user) {
      return {
        ok: false,
        status: 401,
        error: "Anmeldung ungültig oder abgelaufen.",
        code: invalidSessionBeforeEffectErrorCode,
      };
    }
    return { ok: true, user: userResult.user };
  } catch {
    return { ok: false, status: 503, error: "Anmeldung konnte vorübergehend nicht geprüft werden." };
  }
}

async function authorizeUser(
  supabase: SupabaseClient,
  user: User,
  allowedRoles: readonly PlatformRole[],
  options: PlatformRoleCheckOptions = {},
): Promise<AuthzResult> {
  const authProfileResult = await supabase.rpc("current_authenticated_profile");
  if (authProfileResult.error) return { ok: false, status: 403, error: "Teamprofil konnte nicht eindeutig geprüft werden." };

  const profile = authProfileResult.data as AuthzProfileRow | null;
  if (!profile) return { ok: false, status: 403, error: "GitHub-User ist keinem Teamprofil zugeordnet." };
  let effectiveProfile = profile;
  const devProfileId = options.devProfileId?.trim() || "";
  const canUseDevProfile = isOperationalLeadRole(profile.platform_role);

  if (devProfileId && options.devProfileOverrideAllowed && canUseDevProfile) {
    const { data: overrideProfile, error: overrideError } = await supabase
      .from("profiles")
      .select("id,name,platform_role")
      .eq("id", devProfileId)
      .single<Omit<AuthzProfileRow, "github_login">>();

    if (overrideError || !overrideProfile) return { ok: false, status: 403, error: "Dev-Testprofil wurde nicht gefunden." };
    effectiveProfile = { ...overrideProfile, github_login: null };
  }

  if (!allowedRoles.includes(effectiveProfile.platform_role)) {
    return { ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." };
  }

  return { ok: true, profile: mapAuthzProfile(effectiveProfile) };
}

async function requirePlatformRole(
  request: NextRequest,
  allowedRoles: readonly PlatformRole[],
): Promise<AuthzResult> {
  if (!requiresSupabaseAuth()) return { ok: true, profile: null };

  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return { ok: false, status: 401, error: "Anmeldung erforderlich." };

  const authentication = await authenticateUser(supabase);
  if (!authentication.ok) return authentication;

  return authorizeUser(supabase, authentication.user, allowedRoles, {
    devProfileId: request.headers.get("x-fmd-dev-profile-id") || "",
    devProfileOverrideAllowed: devProfileOverrideAllowed(request),
  });
}

export async function requireTeamMemberForSession(supabase: SupabaseClient): Promise<SessionAuthzResult> {
  const authentication = await authenticateUser(supabase);
  if (!authentication.ok) return { ...authentication, user: null };

  const authorization = await authorizeUser(supabase, authentication.user, teamMemberRoles);
  if (!authorization.ok) return { ...authorization, user: authentication.user };
  return { ...authorization, user: authentication.user };
}

export async function loadSessionAuthority(
  supabase: SupabaseClient,
  profile: AuthenticatedProfile,
): Promise<SessionAuthorityContext> {
  const { data, error } = await supabase.rpc("administrator_access_snapshot");
  const administratorAccess = error
    ? inactiveAdministratorAccess
    : (data || inactiveAdministratorAccess) as AdministratorAccessSnapshot;
  return {
    profile,
    ...sessionAuthority({
      platformRole: profile.platformRole,
      credentialKind: "session",
      administratorAccess,
    }),
  };
}

export function requirePlanningContributor(request: NextRequest) {
  return requirePlatformRole(request, planningContributorRoles);
}

export async function requirePlanningContributorOrActiveAdministrator(request: NextRequest): Promise<AuthzResult> {
  return requirePlatformRoleOrOperationalCorrection(request, planningContributorRoles);
}

export function requireCEO(request: NextRequest) {
  return requirePlatformRole(request, ceoRoles);
}

export function requireOperationalLead(request: NextRequest) {
  return requirePlatformRole(request, operationalLeadRoles);
}

export async function requireOperationalLeadOrActiveAdministrator(request: NextRequest): Promise<AuthzResult> {
  return requirePlatformRoleOrOperationalCorrection(request, operationalLeadRoles);
}

export function requireTeamMember(request: NextRequest) {
  return requirePlatformRole(request, teamMemberRoles);
}

async function requireAdministratorCapability(
  request: NextRequest,
  capability: "technicalAdministration" | "manageAdministratorEligibility" | "operationalCorrection",
): Promise<AuthzResult> {
  if (!requiresSupabaseAuth()) {
    return {
      ok: false,
      status: 403,
      error: "Ein echter, aktiver Adminzugang ist erforderlich.",
      code: administratorAccessRequiredErrorCode,
    };
  }

  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return { ok: false, status: 401, error: "Anmeldung erforderlich." };

  const authentication = await authenticateUser(supabase);
  if (!authentication.ok) return authentication;
  const authorization = await authorizeUser(supabase, authentication.user, teamMemberRoles);
  if (!authorization.ok || !authorization.profile) return authorization;

  const { data, error } = await supabase.rpc("administrator_access_snapshot");
  if (error) return { ok: false, status: 403, error: "Adminzugang konnte nicht geprüft werden." };
  const snapshot = (data || inactiveAdministratorAccess) as AdministratorAccessSnapshot;
  const authority: SessionAuthorityContext = {
    profile: authorization.profile,
    ...sessionAuthority({
      platformRole: authorization.profile.platformRole,
      credentialKind: "session",
      administratorAccess: snapshot,
    }),
  };

  if (!authority.capabilities[capability]) {
    const expired = snapshot.eligible && !snapshot.active;
    return {
      ok: false,
      status: 403,
      error: expired ? "Der Adminzugang ist abgelaufen." : "Ein aktiver Adminzugang ist erforderlich.",
      code: expired ? administratorAccessExpiredErrorCode : administratorAccessRequiredErrorCode,
    };
  }

  return { ...authorization, authority };
}

async function requirePlatformRoleOrOperationalCorrection(
  request: NextRequest,
  allowedRoles: readonly PlatformRole[],
): Promise<AuthzResult> {
  if (!requiresSupabaseAuth() || request.headers.has("x-fmd-dev-profile-id")) {
    return requirePlatformRole(request, allowedRoles);
  }

  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return { ok: false, status: 401, error: "Anmeldung erforderlich." };

  const authentication = await authenticateUser(supabase);
  if (!authentication.ok) return authentication;
  const authorization = await authorizeUser(supabase, authentication.user, teamMemberRoles);
  if (!authorization.ok || !authorization.profile) return authorization;

  const roleAllowed = allowedRoles.includes(authorization.profile.platformRole);
  const { data, error } = await supabase.rpc("administrator_access_snapshot");
  if (error) {
    return roleAllowed
      ? authorization
      : { ok: false, status: 403, error: "Adminzugang konnte nicht geprüft werden." };
  }
  const snapshot = (data || inactiveAdministratorAccess) as AdministratorAccessSnapshot;
  const authority: SessionAuthorityContext = {
    profile: authorization.profile,
    ...sessionAuthority({
      platformRole: authorization.profile.platformRole,
      credentialKind: "session",
      administratorAccess: snapshot,
    }),
  };
  if (roleAllowed || authority.capabilities.operationalCorrection) {
    return { ...authorization, authority };
  }

  const expired = snapshot.eligible && !snapshot.active;
  return {
    ok: false,
    status: 403,
    error: expired ? "Der Adminzugang ist abgelaufen." : "Ein aktiver Adminzugang ist erforderlich.",
    code: expired ? administratorAccessExpiredErrorCode : administratorAccessRequiredErrorCode,
  };
}

export async function resolveAdministratorAccessFailure(
  supabase: SupabaseClient,
): Promise<Extract<AuthzResult, { ok: false }>> {
  const { data, error } = await supabase.rpc("administrator_access_snapshot");
  const snapshot = error
    ? inactiveAdministratorAccess
    : (data || inactiveAdministratorAccess) as AdministratorAccessSnapshot;
  const expired = snapshot.eligible && !snapshot.active;
  return {
    ok: false,
    status: 403,
    error: expired ? "Der Adminzugang ist abgelaufen." : "Ein aktiver Adminzugang ist erforderlich.",
    code: expired ? administratorAccessExpiredErrorCode : administratorAccessRequiredErrorCode,
  };
}

export function requireActiveAdministrator(request: NextRequest) {
  return requireAdministratorCapability(request, "technicalAdministration");
}

export function requireAdministratorEligibilityManager(request: NextRequest) {
  return requireAdministratorCapability(request, "manageAdministratorEligibility");
}
