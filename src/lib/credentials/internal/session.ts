import "server-only";
import { observedSupabaseFetch } from "./observed-fetch";
import { classifyCalendarError, observeCalendarPhase, observeCalendarResultPhase, recordCalendarResult, recordCalendarFailure, recordCalendarMembership } from "../../runtime-logging";
import { performance } from "node:perf_hooks";
import { resolveSessionRequest } from "./session-request";
import type { SessionPolicyAction } from "./session-policy-types";
import { createClient, isAuthRetryableFetchError, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { WorkspaceAccessError, workspaceIdentity } from "../../workspace-identity";
import { invalidSessionBeforeEffectErrorCode } from "../../auth-error-contract";
import { isWorkspaceGroupMember } from "./workspace-directory";
import type { AccessContext } from "./workspace-access";
import type { CalendarCredentialResult, CalendarPublication } from "../types";
import type { NextRequest } from "next/server";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const evidence = new Map<string, { verifiedAt: number; expiresAt: number }>();
const pending = new Map<string, Promise<{ verifiedAt: number; expiresAt: number }>>();
const maximumEvidence = 1024;
const cacheOwnerId = randomUUID();
const unavailable = () => new WorkspaceAccessError(503, "workspace_access_unavailable");
const denied = () => new WorkspaceAccessError(403, "workspace_access_denied");
const loginRequired = () => new WorkspaceAccessError(403, "workspace_google_login_required");
const invalidSession = () => ({ ok: false as const, status: 401, error: "Anmeldung ungültig oder abgelaufen.", code: invalidSessionBeforeEffectErrorCode });

async function membership(key: string, email: string, startedAt: number, credentialDeadline: number) {
  let expired = false;
  let capacityEvictions = 0;
  for (const [candidate, entry] of evidence) if (entry.expiresAt <= Date.now()) {
    if (candidate === key) expired = true;
    evidence.delete(candidate);
  }
  const observe = (result: "hit" | "miss" | "expired" | "coalesced", entry?: { verifiedAt: number; expiresAt: number }, waitMs?: number) => recordCalendarMembership({
    result, reason: result === "hit" ? "cached" : result === "coalesced" ? "in_flight" : expired ? "observed_expiry" : "not_found",
    cacheOwnerId, expired, ...(capacityEvictions ? { capacityEvictions } : {}), evidenceAgeMs: entry ? Math.max(0, Date.now() - entry.verifiedAt) : null,
    remainingLifetimeMs: entry ? Math.max(0, entry.expiresAt - Date.now()) : null, ...(waitMs === undefined ? {} : { waitMs }),
  });
  const cached = evidence.get(key);
  if (cached) { observe("hit", cached); return cached; }
  const running = pending.get(key);
  if (running) {
    const waiting = performance.now();
    observe("coalesced");
    try { const entry = await observeCalendarPhase("workspace.wait", () => running); observe("coalesced", entry, performance.now() - waiting); return entry; }
    catch (error) { observe("coalesced", undefined, performance.now() - waiting); throw error; }
  }
  observe(expired ? "expired" : "miss");
  const verification = (async () => {
    let member: boolean;
    try { member = await observeCalendarPhase("workspace.membership", () => isWorkspaceGroupMember(email)); } catch { throw unavailable(); }
    if (!member) throw denied();
    const entry = { verifiedAt: startedAt, expiresAt: Math.min(startedAt + 900_000, credentialDeadline) };
    if (Date.now() >= entry.expiresAt) throw unavailable();
    if (evidence.size >= maximumEvidence) { evidence.delete(evidence.keys().next().value!); capacityEvictions++; }
    evidence.set(key, entry);
    observe(expired ? "expired" : "miss", entry);
    return entry;
  })();
  pending.set(key, verification);
  try { return await verification; } finally { if (pending.get(key) === verification) pending.delete(key); }
}

function clients() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key || !secret) {
    recordCalendarFailure({ operation: "calendar.authorization", errorCode: "provider_configuration_invalid", errorCategory: "configuration_error" });
    throw unavailable();
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: observedSupabaseFetch } };
  return { url: url.replace(/\/$/, ""), key, options, auth: createClient(url, key, options), service: createClient(url, secret, options) };
}

async function workspaceContext(service: SupabaseClient, userId: string): Promise<AccessContext> {
  const result = await observeCalendarResultPhase("workspace.context", () => service.rpc("workspace_access_context", { p_user_id: userId, p_profile_id: null }));
  if (result.error || !result.data || !["legacy", "linking", "google"].includes(result.data.mode)) {
    if (!result.error) recordCalendarFailure({ operation: "workspace.context", errorCode: "provider_response_invalid", errorCategory: "invalid_response" });
    throw unavailable();
  }
  return { linkingEnforced: false, ...result.data };
}

type SessionBinding = {
  token: string; userId: string; sessionId: string; profileId: string; deadline: number;
  workspace: boolean; url: string; service: SupabaseClient; auth: SupabaseClient;
  mode: AccessContext["mode"]; linkingEnforced: boolean; subject?: string; email?: string;
};

function boundDataFetch(binding: SessionBinding, assertDispatch?: () => void): typeof fetch {
  return async (input, init) => {
    try {
      const request = new Request(input, init);
      const url = new URL(request.url);
      if (url.origin !== new URL(binding.url).origin || !url.pathname.startsWith("/rest/v1/")) throw denied();
      if (Date.now() >= binding.deadline) throw loginRequired();
      const user = await observeCalendarPhase("supabase.user", () => binding.auth.auth.getUser(binding.token));
      if (user.error) {
        if (isAuthRetryableFetchError(user.error) || (user.error.status || 0) >= 500) recordCalendarResult("supabase.user", user.error);
        if (isAuthRetryableFetchError(user.error) || (user.error.status || 0) >= 500) throw unavailable();
        throw denied();
      }
      if (user.data.user?.id !== binding.userId) throw denied();
      const current = await workspaceContext(binding.service, binding.userId);
      if (current.userId !== binding.userId || current.profileId !== binding.profileId
        || current.mode !== binding.mode || current.linkingEnforced !== binding.linkingEnforced) throw denied();
      if (binding.workspace) {
        if (!current.linked || !current.identity) throw denied();
        const identity = workspaceIdentity({ id: binding.userId, identities: [{ provider: "google", identity_data: current.identity }] });
        if (identity.subject !== binding.subject || identity.email !== binding.email) throw denied();
      }
      if (Date.now() >= binding.deadline) throw loginRequired();
      request.headers.set("authorization", `Bearer ${binding.token}`);
      if (!binding.workspace) {
        assertDispatch?.();
        return observedSupabaseFetch(request);
      }
      const permit = randomBytes(32).toString("base64url");
      const hash = digest(permit);
      const issued = await observeCalendarResultPhase("workspace.permit.issue", () => binding.service.rpc("workspace_issue_permit", {
        p_hash: hash, p_user_id: binding.userId, p_jwt_hash: digest(binding.token), p_method: request.method,
        p_path: url.pathname.slice("/rest/v1".length), p_session_id: binding.sessionId,
      }));
      if (issued.error) throw issued.error.code === "42501" ? denied() : unavailable();
      // A slow permit cannot extend either the credential or the evidence deadline.
      try {
        if (Date.now() >= binding.deadline) throw loginRequired();
        assertDispatch?.();
        request.headers.set("x-founderops-workspace-permit", permit);
        return await observedSupabaseFetch(request);
      } finally {
        // Cleanup never retries the operation, including a lost mutation response.
        await observeCalendarPhase("workspace.permit.release", async () => {
          const released = await binding.service.rpc("workspace_release_permit", { p_hash: hash });
          recordCalendarResult("workspace.permit.release", released.error, "permit_cleanup_failed");
        }).catch(error => {
          recordCalendarFailure({ operation: "workspace.permit.release", errorCode: "permit_cleanup_failed", errorCategory: classifyCalendarError(error) });
        });
      }
    } catch (error) {
      // Expected denials are HTTP responses so the SDK cannot retry them as network failures.
      if (error instanceof WorkspaceAccessError) return Response.json({ message: error.message, code: error.code }, { status: error.status });
      throw error;
    }
  };
}

type SessionAction = SessionPolicyAction | "calendar.read" | "workweek.private.read" | "workweek.private.write" | "session.planning" | "session.home";
type SessionDataResult = Extract<CalendarCredentialResult, { ok: false }> | {
  ok: true; profile: Extract<CalendarCredentialResult, { ok: true }>["profile"]; user: User;
  assertCurrent(): void;
  constrainedData(assertDispatch: () => void): SupabaseClient;
  data: SupabaseClient; readOwnerConflict(versionId: string): Promise<{ data: { resolution_version_id: string } | null; error: { message: string } | null }>;
};

export async function authorizeSessionData(request: NextRequest, action: SessionAction, startedAt = Date.now()): Promise<SessionDataResult> {
  const transport = resolveSessionRequest(request);
  if (transport.denial) return transport.denial;
  const token = transport.token;
  if (!token) return { ok: false, status: 401, error: "Anmeldung erforderlich." };
  try {
    const environment = clients();
    const verified = await observeCalendarPhase("supabase.claims", () => environment.auth.auth.getClaims(token));
    if (verified.error) {
      if (isAuthRetryableFetchError(verified.error) || (verified.error.status || 0) >= 500) recordCalendarResult("supabase.claims", verified.error);
      if (isAuthRetryableFetchError(verified.error) || (verified.error.status || 0) >= 500) return { ok: false, status: 503, error: "Anmeldung konnte vorübergehend nicht geprüft werden." };
      return invalidSession();
    }
    const claims = verified.data?.claims;
    const audience = claims?.aud;
    if (!claims || claims.iss !== `${environment.url}/auth/v1` || claims.role !== "authenticated"
      || !(audience === "authenticated" || (Array.isArray(audience) && audience.includes("authenticated")))
      || typeof claims.sub !== "string" || !claims.sub || typeof claims.exp !== "number"
      || claims.exp * 1000 <= Date.now() || (typeof claims.nbf === "number" && claims.nbf * 1000 > Date.now())
      || typeof claims.session_id !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(claims.session_id)) return invalidSession();
    // Signature validity does not defer mutable account validity, profile binding or session admission.
    const user = await observeCalendarPhase("supabase.user", () => environment.auth.auth.getUser(token));
    if (user.error) {
      if (isAuthRetryableFetchError(user.error) || (user.error.status || 0) >= 500) recordCalendarResult("supabase.user", user.error);
      if (isAuthRetryableFetchError(user.error) || (user.error.status || 0) >= 500) return { ok: false, status: 503, error: "Anmeldung konnte vorübergehend nicht geprüft werden." };
      return invalidSession();
    }
    if (user.data.user?.id !== claims.sub) return invalidSession();
    const context = await workspaceContext(environment.service, claims.sub);
    if (context.userId !== claims.sub || !context.profileId) {
      return { ok: false, status: 403, error: "Dieses Konto ist keinem Teamprofil zugeordnet." };
    }
    const workspace = context.mode === "google" || (context.mode === "linking" && context.linkingEnforced);
    let deadline = claims.exp * 1000;
    let subject: string | undefined;
    let email: string | undefined;
    if (workspace) {
      if (context.mode === "linking" && !context.linked) throw new WorkspaceAccessError(403, "workspace_link_required");
      if (!context.linked || !context.identity) throw denied();
      const identity = workspaceIdentity({ id: claims.sub, identities: [{ provider: "google", identity_data: context.identity }] });
      subject = identity.subject; email = identity.email;
      if (!Array.isArray(claims.amr) || !claims.amr.some(entry => typeof entry === "object" && entry.method === "oauth")) throw loginRequired();
      const session = await observeCalendarResultPhase("workspace.session", () => environment.service.rpc(context.mode === "linking" ? "workspace_linking_session_allowed" : "workspace_session_allowed", {
        p_user_id: claims.sub, p_session_id: claims.session_id,
      }));
      if (session.error) throw unavailable();
      if (session.data !== true) throw loginRequired();
      if (context.mode === "google") {
        await observeCalendarPhase("supabase.settings", async () => {
          const settings = await observedSupabaseFetch(`${environment.url}/auth/v1/settings`, { headers: { apikey: environment.key }, cache: "no-store", signal: AbortSignal.timeout(5000) });
          if (!settings.ok) throw unavailable();
          let configuration;
          try { configuration = await settings.json(); } catch (error) {
            recordCalendarFailure({ operation: "supabase.settings", errorCode: "provider_response_invalid", errorCategory: "invalid_response" });
            throw error;
          }
          if (!configuration || configuration.external?.google !== true || Object.entries(configuration.external).some(([provider, enabled]) => provider !== "google" && enabled === true)) {
            recordCalendarFailure({ operation: "supabase.settings", errorCode: "provider_configuration_invalid", errorCategory: "configuration_error" });
            throw unavailable();
          }
        });
      }
      const key = digest(JSON.stringify(["session-request", token, environment.url, claims.sub, claims.session_id,
        context.profileId, identity.subject, identity.email, context.mode, context.linkingEnforced,
        process.env.GOOGLE_AUTHORIZED_GROUP, process.env.GOOGLE_WORKLOAD_IDENTITY_AUDIENCE, process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT,
        claims.aud, claims.role, claims.scope, action, "session-policy-v1"]));
      deadline = (await membership(key, identity.email, startedAt, deadline)).expiresAt;
    }
    if (!workspace) recordCalendarMembership({ result: "bypass", reason: "not_required", cacheOwnerId, evidenceAgeMs: null, remainingLifetimeMs: null, expired: false });
    const binding: SessionBinding = { token, userId: claims.sub, sessionId: claims.session_id,
      profileId: context.profileId, deadline, workspace, url: environment.url, service: environment.service, auth: environment.auth,
      mode: context.mode, linkingEnforced: context.linkingEnforced, subject, email };
    const constrainedData = (assertDispatch: () => void) => createClient(environment.url, environment.key, { ...environment.options,
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: boundDataFetch(binding, assertDispatch) },
    });
    const data = constrainedData(() => {});
    // This live user-bound RPC also enforces profile rebinding and current role before every action.
    const profile = await observeCalendarResultPhase("calendar.profile", () => data.rpc("current_authenticated_profile"));
    if (Date.now() >= claims.exp * 1000) return invalidSession();
    if (Date.now() >= deadline) throw unavailable();
    if (profile.error) return { ok: false, status: 403, error: "Teamprofil konnte nicht eindeutig geprüft werden." };
    if (!profile.data || profile.data.id !== binding.profileId
      || !["ceo", "founder", "deputy", "viewer"].includes(profile.data.platform_role)) throw denied();
    if (Date.now() >= deadline) throw unavailable();
    return { constrainedData, assertCurrent: () => { if (Date.now() >= binding.deadline) throw unavailable(); }, ok: true, profile: { id: profile.data.id, name: profile.data.name, platformRole: profile.data.platform_role, githubLogin: "" }, user: user.data.user, data,
      readOwnerConflict: async (versionId: string) => {
        if (action !== "workweek.private.read") return { data: null, error: { message: "Keine Berechtigung für diesen Konfliktstatus." } };
        // Service-backed conflict state has its own live authorization and owner restriction.
        const current = await data.rpc("current_authenticated_profile");
        if (current.error || current.data?.id !== binding.profileId || Date.now() >= binding.deadline) {
          return { data: null, error: { message: "Privater Konfliktstatus konnte nicht geprüft werden." } };
        }
        return await environment.service.from("team_workweek_google_conflicts").select("resolution_version_id")
          .eq("owner_profile_id", binding.profileId).eq("founderops_version_id", versionId).eq("state", "resolving")
          .maybeSingle<{ resolution_version_id: string }>();
      },
    };
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return { ok: false, status: error.status, code: error.code, error: error.message };
    return { ok: false, status: 503, error: "Anmeldung konnte vorübergehend nicht geprüft werden." };
  }
}

export async function authorizeCalendar(request: NextRequest): Promise<CalendarCredentialResult> {
  const authorized = await observeCalendarPhase("calendar.authorization", () => authorizeSessionData(request, "calendar.read"));
  if (!authorized.ok) return authorized;
  const { data, profile } = authorized;
  return { ok: true, profile, calendar: {
    readPublications: async (earliestDate: string) => await observeCalendarResultPhase("calendar.publications", () => data.from("team_workweek_publications")
      .select("id,owner_profile_id,effective_from,effective_to,effective_at,effective_until,timezone,published_at,last_sync_at,publication_revision,windows")
      .eq("status", "published").or(`effective_to.is.null,effective_to.gte.${earliestDate}`)
      .order("effective_from", { ascending: false }).order("publication_revision", { ascending: false }).order("id", { ascending: false })
      .returns<CalendarPublication[]>()),
    readPublishedOwners: async () => await observeCalendarResultPhase("calendar.owners", () => data.from("team_workweek_publications").select("owner_profile_id").eq("status", "published")
      .returns<Array<{ owner_profile_id: string }>>()),
  } };
}
