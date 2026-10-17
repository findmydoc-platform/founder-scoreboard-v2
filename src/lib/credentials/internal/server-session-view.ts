import "server-only";
import type { NextRequest } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { rootWorkspaceFromPreference, type AppWorkspace } from "@/features/planning/model/workspace-routes";
import { loadSessionAuthority } from "./session-policy";
import { assertGoogleSession, requireWorkspaceAccess, workspaceAccessContext } from "./workspace-access";
import { authorizeSessionData } from "./session";
import { getServerAuthSupabase } from "./cookie-client";
import type { ServerPlanningAuth, SessionLinkPageState } from "../session-types";

async function planningContext(action: "session.planning" | "session.home") {
  const startedAt = Date.now();
  const client = await getServerAuthSupabase();
  if (!client) return { ok: false as const, status: 401, error: "Anmeldung erforderlich.", user: null };
  const current = await client.auth.getSession();
  if (current.error) return { ok: false as const, status: isAuthRetryableFetchError(current.error) ? 503 : 401, error: "Anmeldung konnte nicht geprüft werden.", user: null };
  if (!current.data.session) return { ok: false as const, status: 401, error: "Anmeldung erforderlich.", user: null };
  const request = { headers: new Headers({ authorization: `Bearer ${current.data.session.access_token}` }) } as NextRequest;
  const result = await authorizeSessionData(request, action, startedAt);
  if (!result.ok) {
    const user = result.status === 403 && !result.code ? (await client.auth.getUser(current.data.session.access_token)).data.user : null;
    return { ...result, user };
  }
  return result;
}

export function serverPlanningContext() { return planningContext("session.planning"); }

export async function serverPlanningAuth(): Promise<ServerPlanningAuth> {
  const auth = await serverPlanningContext();
  if (!auth.ok) return auth;
  const authority = await loadSessionAuthority(auth.data, auth.profile);
  return { ok: true, user: auth.user, profile: auth.profile, authority };
}

export async function serverHomeWorkspace(): Promise<AppWorkspace> {
  const auth = await planningContext("session.home");
  if (!auth.ok) return "planning";
  const preference = await auth.data.from("profile_ui_preferences").select("default_workspace").eq("profile_id", auth.profile.id).maybeSingle<{ default_workspace: string }>();
  return preference.error ? "planning" : rootWorkspaceFromPreference(preference.data?.default_workspace);
}

export async function serverLinkPage(): Promise<SessionLinkPageState> {
  const client = await getServerAuthSupabase();
  const user = client ? (await client.auth.getUser()).data.user : null;
  const context = await workspaceAccessContext(user ? { userId: user.id } : {}).catch(() => null);
  const session = user && context?.linked && context.linkingEnforced ? (await client?.auth.getSession())?.data.session : null;
  const approved = session && user ? await Promise.all([
    requireWorkspaceAccess({ userId: user.id }), assertGoogleSession(session.access_token, user.id),
  ]).then(() => true).catch(() => false) : false;
  return { user: user ? { id: user.id } : null, context: context ? { mode: context.mode, linked: context.linked, linkingEnforced: context.linkingEnforced, profileId: context.profileId } : null, approved: Boolean(approved) };
}
