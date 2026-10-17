import type { NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AuthErrorCode } from "./auth-error-contract";
import type { SessionAuthorityContext } from "@/features/administrator-access/model/administrator-access";
import type { AuthenticatedProfile } from "./types";
import { authorizeCredentialAction } from "./credentials";
import { legacySessionToken, legacyTeamMemberForSession, legacyAdministratorAccessFailure } from "./credentials/internal/legacy-session-client";

type AuthzFailure = { ok: false; status: number; error: string; code?: AuthErrorCode };

export type AuthzResult =
  | { ok: true; profile: AuthenticatedProfile | null; authority?: SessionAuthorityContext }
  | AuthzFailure;

export type SessionAuthzResult =
  | { ok: true; user: User; profile: AuthenticatedProfile | null }
  | (AuthzFailure & { user: User | null });


export function bearerToken(request: NextRequest) { return legacySessionToken(request); }
export function requireTeamMember(request: NextRequest): Promise<AuthzResult> { return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "team.read" }); }
export function requirePlanningContributor(request: NextRequest): Promise<AuthzResult> { return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.contribute" }); }
export function requireCEO(request: NextRequest): Promise<AuthzResult> { return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "governance.ceo" }); }
export function requireOperationalLead(request: NextRequest): Promise<AuthzResult> { return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "operations.lead" }); }
export function requirePlanningContributorOrActiveAdministrator(request: NextRequest): Promise<AuthzResult> { return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.correct" }); }
export function requireOperationalLeadOrActiveAdministrator(request: NextRequest): Promise<AuthzResult> { return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "operations.correct" }); }
export function requireActiveAdministrator(request: NextRequest): Promise<AuthzResult> { return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administration.technical" }); }
export function requireAdministratorEligibilityManager(request: NextRequest): Promise<AuthzResult> { return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administration.eligibility" }); }

// Existing client-argument compatibility only; no new consumers. Removed by #502 after #504/#505 migrate them.
export function requireTeamMemberForSession(client: SupabaseClient): Promise<SessionAuthzResult> { return legacyTeamMemberForSession(client); }
export function resolveAdministratorAccessFailure(client: SupabaseClient): Promise<Extract<AuthzResult, { ok: false }>> { return legacyAdministratorAccessFailure(client); }
