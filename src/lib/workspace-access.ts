import "server-only";
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
  try {
    const service = getServerServiceRoleSupabase();
    const verified = await service?.auth.getUser(token);
    if (verified?.error || verified?.data.user?.id !== userId) throw new Error("Invalid session owner");
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (!claims.session_id || !claims.amr?.some((entry: { method: string }) => entry.method === "oauth")) throw new Error("Invalid Google session");
    const context = await workspaceAccessContext({ userId });
    const linking = context.mode === "linking" && context.linkingEnforced;
    const result = await service?.rpc(linking ? "workspace_linking_session_allowed" : "workspace_session_allowed", { p_user_id: userId, p_session_id: claims.session_id });
    if (result?.error || result?.data !== true) throw new Error("Session predates cutover");
    if (linking) return;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error("Auth unavailable");
    const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Auth unavailable");
    const settings = await response.json();
    if (settings.external?.google !== true || Object.entries(settings.external).some(([provider, enabled]) => provider !== "google" && enabled === true)) throw new Error("Non-Google provider remains enabled");
  } catch { throw new WorkspaceAccessError(403, "workspace_google_login_required"); }
}
