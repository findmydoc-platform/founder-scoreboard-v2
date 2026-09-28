import "server-only";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { getServerServiceRoleSupabase } from "./supabase-service-role";
import { authorizeWorkspaceIdentity, WorkspaceAccessError, type WorkspaceIdentity } from "./workspace-identity";
import { isWorkspaceGroupMember } from "./workspace-directory";

export type WorkspaceLoginMode = "legacy" | "linking" | "google";
export type AccessContext = { mode: WorkspaceLoginMode; linkingEnforced: boolean; userId: string | null; profileId: string | null; linked: boolean; identity: Record<string, unknown> | null };

export async function workspaceAccessContext(input: { userId?: string; profileId?: string } = {}): Promise<AccessContext> {
  const service = getServerServiceRoleSupabase();
  const result = service ? await service.rpc("workspace_access_context", { p_user_id: input.userId || null, p_profile_id: input.profileId || null }) : null;
  if (result?.error || !result?.data || !["legacy", "linking", "google"].includes(result.data.mode)) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
  return { linkingEnforced: false, ...result.data } as AccessContext;
}

export async function requireWorkspaceAccess(input: { userId?: string; profileId?: string }, requireLinked = true): Promise<WorkspaceIdentity | null> {
  const context = await workspaceAccessContext(input);
  if (context.mode === "legacy" || (context.mode === "linking" && !context.linkingEnforced && requireLinked)) return null;
  if (context.mode === "linking" && context.linkingEnforced && requireLinked && context.profileId && !context.linked) throw new WorkspaceAccessError(403, "workspace_link_required");
  if (process.env.VERCEL_ENV === "preview" || !context.userId || !context.profileId || !context.identity || (requireLinked && !context.linked)) throw new WorkspaceAccessError(403, "workspace_access_denied");
  return authorizeWorkspaceIdentity({ id: context.userId, identities: [{ provider: "google", identity_data: context.identity }] }, isWorkspaceGroupMember);
}

export async function assertGoogleSession(token: string, userId: string) {
  const unavailable = () => new WorkspaceAccessError(503, "workspace_access_unavailable");
  const loginRequired = () => new WorkspaceAccessError(403, "workspace_google_login_required");
  const service = getServerServiceRoleSupabase();
  if (!service) throw unavailable();
  const verified = await service.auth.getUser(token).catch(() => { throw unavailable(); });
  if (verified.error) {
    if (isAuthRetryableFetchError(verified.error) || (verified.error.status ?? 0) >= 500) throw unavailable();
    throw loginRequired();
  }
  if (verified.data.user?.id !== userId) throw loginRequired();
  let claims: { session_id?: unknown; amr?: Array<{ method?: string }> };
  try { claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")); }
  catch { throw loginRequired(); }
  if (!claims || typeof claims.session_id !== "string" || !Array.isArray(claims.amr) || !claims.amr.some(entry => entry.method === "oauth")) throw loginRequired();
  const context = await workspaceAccessContext({ userId });
  const linking = context.mode === "linking" && context.linkingEnforced;
  let result;
  try {
    result = await service.rpc(linking ? "workspace_linking_session_allowed" : "workspace_session_allowed", { p_user_id: userId, p_session_id: claims.session_id });
  } catch { throw unavailable(); }
  if (result.error) throw unavailable();
  if (result.data !== true) throw loginRequired();
  if (linking) return claims.session_id;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw unavailable();
  const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(5000) }).catch(() => { throw unavailable(); });
  if (!response.ok) throw unavailable();
  const settings = await response.json().catch(() => { throw unavailable(); });
  if (settings.external?.google !== true || Object.entries(settings.external).some(([provider, enabled]) => provider !== "google" && enabled === true)) throw unavailable();
  return claims.session_id;
}
