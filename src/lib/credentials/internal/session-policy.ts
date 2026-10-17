import "server-only";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedProfile, PlatformRole } from "../../types";
import type { AuthzResult } from "../../authz";
import { requiresSupabaseAuth } from "../../supabase";
import { isLocalLoginRequestAllowed } from "../../local-development-auth";
import { administratorAccessExpiredErrorCode, administratorAccessRequiredErrorCode } from "../../auth-error-contract";
import { inactiveAdministratorAccess, sessionAuthority, type AdministratorAccessSnapshot, type SessionAuthorityContext } from "@/features/administrator-access/model/administrator-access";
import type { CredentialAction } from "../types";
import { authorizeSessionData } from "./session";
import { resolveSessionRequest } from "./session-request";

const roleActions: Partial<Record<CredentialAction, readonly PlatformRole[]>> = {
  "team.read": ["ceo", "founder", "deputy", "viewer"],
  "planning.contribute": ["ceo", "founder", "deputy"],
  "governance.ceo": ["ceo"],
  "operations.lead": ["ceo", "deputy"],
  "planning.correct": ["ceo", "founder", "deputy"],
  "operations.correct": ["ceo", "deputy"],
};

export function rolePermitsAction(action: CredentialAction, role: PlatformRole) {
  return roleActions[action]?.includes(role) === true;
}

export function currentAdministratorAccess(value: AdministratorAccessSnapshot | null): AdministratorAccessSnapshot {
  if (!value) return { ...inactiveAdministratorAccess };
  const active = value.eligible === true && value.active === true && typeof value.expiresAt === "string" && Date.parse(value.expiresAt) > Date.now();
  return { eligible: value.eligible === true, active, expiresAt: active ? value.expiresAt : null };
}

export function administratorAccessFailure(snapshot: AdministratorAccessSnapshot): Extract<AuthzResult, { ok: false }> {
  const expired = snapshot.eligible && !snapshot.active;
  return { ok: false, status: 403, error: expired ? "Der Adminzugang ist abgelaufen." : "Ein aktiver Adminzugang ist erforderlich.",
    code: expired ? administratorAccessExpiredErrorCode : administratorAccessRequiredErrorCode };
}

export async function loadSessionAuthority(data: SupabaseClient, profile: AuthenticatedProfile): Promise<SessionAuthorityContext> {
  const result = await data.rpc("administrator_access_snapshot");
  return { profile, ...sessionAuthority({ platformRole: profile.platformRole, credentialKind: "session",
    administratorAccess: currentAdministratorAccess(result.error ? null : result.data) }) };
}

export async function authorizeSessionPolicy(request: NextRequest, action: CredentialAction, startedAt = Date.now()) {
  const transport = resolveSessionRequest(request);
  if (transport.denial) return transport.denial;
  const administratorCapability = action === "administration.technical" ? "technicalAdministration"
    : action === "administration.eligibility" ? "manageAdministratorEligibility" : null;
  const correction = action === "planning.correct" || action === "operations.correct";
  if (!requiresSupabaseAuth()) {
    if (!isLocalLoginRequestAllowed(request.headers.get("host") || "")) return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
    if (administratorCapability) return { ok: false as const, status: 403, error: "Ein echter, aktiver Adminzugang ist erforderlich.", code: administratorAccessRequiredErrorCode };
    return { ok: true as const, profile: null, data: null };
  }
  const context = await authorizeSessionData(request, action, startedAt);
  if (!context.ok) return context;
  let profile = context.profile;
  const override = request.headers.get("x-fmd-dev-profile-id")?.trim();
  if (!administratorCapability && override && isLocalLoginRequestAllowed(request.headers.get("host") || "") && ["ceo", "deputy"].includes(profile.platformRole)) {
    const selected = await context.data.from("profiles").select("id,name,platform_role").eq("id", override).single();
    if (selected.error || !selected.data || !["ceo", "founder", "deputy", "viewer"].includes(selected.data.platform_role)) return { ok: false as const, status: 403, error: "Dev-Testprofil wurde nicht gefunden." };
    profile = { id: selected.data.id, name: selected.data.name, platformRole: selected.data.platform_role, githubLogin: "" };
  }
  const roleAllowed = rolePermitsAction(action, profile.platformRole);
  if (!administratorCapability && (!correction || request.headers.has("x-fmd-dev-profile-id"))) {
    if (!roleAllowed) return { ok: false as const, status: 403, error: "Keine Berechtigung für diese Aktion." };
    return { ...context, profile };
  }
  const result = await context.data.rpc("administrator_access_snapshot");
  if (result.error) return roleAllowed && correction ? { ...context, profile }
    : { ok: false as const, status: 403, error: "Adminzugang konnte nicht geprüft werden." };
  const snapshot = currentAdministratorAccess(result.data);
  const authority = { profile, ...sessionAuthority({ platformRole: profile.platformRole, credentialKind: "session", administratorAccess: snapshot }) };
  if (!(roleAllowed && correction) && !authority.capabilities[administratorCapability || "operationalCorrection"]) return administratorAccessFailure(snapshot);
  return { ...context, profile, authority };
}
