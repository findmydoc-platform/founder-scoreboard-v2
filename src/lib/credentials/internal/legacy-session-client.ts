import "server-only";
import { isAuthRetryableFetchError, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import type { AuthzResult, SessionAuthzResult } from "../../authz";
import { invalidSessionBeforeEffectErrorCode } from "../../auth-error-contract";
import { assertGoogleSession, requireWorkspaceAccess } from "../../workspace-access";
import { WorkspaceAccessError } from "../../workspace-identity";
import { administratorAccessFailure, currentAdministratorAccess, rolePermitsAction } from "./session-policy";
import { resolveSessionRequest } from "./session-request";

// Transitional client-argument adapters only. Existing domain callers migrate in #504/#505; #502 removes these exports.
export function legacySessionToken(request: NextRequest) { return resolveSessionRequest(request).token; }

export async function legacyTeamMemberForSession(client: SupabaseClient): Promise<SessionAuthzResult> {
  try {
    const current = await client.auth.getUser();
    if (isAuthRetryableFetchError(current.error)) return { ok: false, status: 503, error: "Anmeldung konnte vorübergehend nicht geprüft werden.", user: null };
    if (current.error || !current.data.user) return { ok: false, status: 401, error: "Anmeldung ungültig oder abgelaufen.", code: invalidSessionBeforeEffectErrorCode, user: null };
    const user = current.data.user;
    const identity = await requireWorkspaceAccess({ userId: user.id });
    if (identity) {
      const session = await client.auth.getSession();
      if (session.error) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
      if (!session.data.session?.access_token) throw new WorkspaceAccessError(403, "workspace_google_login_required");
      await assertGoogleSession(session.data.session.access_token, user.id);
    }
    const result = await client.rpc("current_authenticated_profile");
    if (result.error) return { ok: false, status: 403, error: "Teamprofil konnte nicht eindeutig geprüft werden.", user };
    if (!result.data) return { ok: false, status: 403, error: "Dieses Konto ist keinem Teamprofil zugeordnet.", user };
    if (!result.data.id || !rolePermitsAction("team.read", result.data.platform_role)) return { ok: false, status: 403, error: "Keine Berechtigung für diese Aktion.", user };
    return { ok: true, user, profile: { id: result.data.id, name: result.data.name, platformRole: result.data.platform_role, githubLogin: "" } };
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return { ok: false, status: error.status, code: error.code, error: error.message, user: null };
    return { ok: false, status: 503, error: "Anmeldung konnte vorübergehend nicht geprüft werden.", user: null };
  }
}

export async function legacyAdministratorAccessFailure(client: SupabaseClient): Promise<Extract<AuthzResult, { ok: false }>> {
  const result = await client.rpc("administrator_access_snapshot");
  return administratorAccessFailure(currentAdministratorAccess(result.error ? null : result.data));
}
