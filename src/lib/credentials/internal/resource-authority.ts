import "server-only";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { headers } from "next/headers";
import type { NextRequest } from "next/server";
import type { ResourceCredentialInput } from "../resource-types";
import { authorizeSessionPolicy, currentAdministratorAccess, rolePermitsAction } from "./session-policy";
import { getServerAuthSupabase } from "./cookie-client";
import { accountServiceConfiguration } from "./account-service";
import { planningService } from "./planning-service";
import { requiresSupabaseAuth } from "../../supabase-configuration";
import { WorkspaceAccessError } from "../../workspace-identity";
import { isLocalLoginRequestAllowed } from "../../local-development-auth";

export async function resourceAuthority(input: ResourceCredentialInput, startedAt: number) {
  const action = input.action;
  const configuration = accountServiceConfiguration(false);
  if (!configuration.url || !configuration.key) return { ok: false as const, status: 501, error: "Supabase env is not configured." };
  let request: NextRequest;
  if (input.credential.kind === "server-cookies") {
    const requestHeaders = new Headers(await headers());
    if (requiresSupabaseAuth()) {
      const client = await getServerAuthSupabase();
      const result = client ? await client.auth.getSession() : null;
      if (result?.error && (isAuthRetryableFetchError(result.error) || (result.error.status || 0) >= 500)) return { ok: false as const, status: 503, error: "Anmeldung konnte nicht geprüft werden." };
      if (result?.error || !result?.data.session?.access_token) return { ok: false as const, status: 401, error: "Anmeldung erforderlich." };
      requestHeaders.set("authorization", `Bearer ${result.data.session.access_token}`);
    }
    request = { headers: requestHeaders, method: "GET" } as NextRequest;
  } else request = { headers: new Headers(input.credential.request.headers), method: input.credential.request.method, url: input.credential.request.url } as NextRequest;
  const policy = action === "events.create" || action === "events.update" ? "operations.correct"
    : action === "tools.create" || action === "tools.update" || action === "tools.metadata" || action === "assets.github.read" ? "planning.contribute" : "team.read";
  const permission = await authorizeSessionPolicy(request, policy, startedAt);
  if (!permission.ok) return permission;
  const profile = permission.profile ? Object.freeze({ ...permission.profile }) : null;
  const authority = "authority" in permission ? permission.authority : undefined;
  const correction = authority?.capabilities.operationalCorrection === true;
  const administratorDeadline = correction ? Date.parse(authority!.administratorAccess.expiresAt || "") : Infinity;
  const assertCurrent = () => {
    if ("assertCurrent" in permission) permission.assertCurrent();
    if (Date.now() >= administratorDeadline) throw new WorkspaceAccessError(403, "workspace_access_denied");
    const active = accountServiceConfiguration(false);
    if (active.url !== configuration.url || active.key !== configuration.key) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
  };
  const current = async () => {
    if (permission.data) {
      const latest = await permission.data.rpc("current_authenticated_profile");
      if (latest.error) throw new WorkspaceAccessError(latest.status >= 500 ? 503 : 403, latest.status >= 500 ? "workspace_access_unavailable" : "workspace_access_denied");
      if (latest.data?.id !== profile?.id || latest.data?.platform_role !== profile?.platformRole) {
        const override = request.headers.get("x-fmd-dev-profile-id")?.trim();
        if (!override || override !== profile?.id || !isLocalLoginRequestAllowed(request.headers.get("host") || "") || !latest.data || !rolePermitsAction("operations.lead", latest.data.platform_role)) throw new WorkspaceAccessError(403, "workspace_access_denied");
        const selected = await permission.data.from("profiles").select("id,platform_role").eq("id", profile.id).single();
        if (selected.error || selected.data?.id !== profile.id || selected.data?.platform_role !== profile.platformRole) throw new WorkspaceAccessError(403, "workspace_access_denied");
      }
      if (correction) {
        const snapshot = await permission.data.rpc("administrator_access_snapshot");
        if (snapshot.error || !currentAdministratorAccess(snapshot.data).active) throw new WorkspaceAccessError(403, "workspace_access_denied");
      }
    }
    assertCurrent();
  };
  const reassert = async () => {
    try { await current(); return null; }
    catch (error) { const denied = error instanceof WorkspaceAccessError ? error : new WorkspaceAccessError(503, "workspace_access_unavailable"); return { status: denied.status, code: denied.code, message: denied.message }; }
  };
  const service = planningService(false, reassert, assertCurrent)!;
  const strictService = planningService(true, reassert, assertCurrent);
  const userData = "constrainedData" in permission ? permission.constrainedData(assertCurrent) : permission.data;
  return { ok: true as const, profile, correction, service, userData, followup: planningService(false)!, current, assertCurrent, request, strictService, strictFollowup: planningService(true) };
}
