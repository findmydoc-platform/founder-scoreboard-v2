import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { assertGoogleSession, requireWorkspaceAccess } from "./workspace-access";
import { getServerServiceRoleSupabase } from "./supabase-service-role";
import { WorkspaceAccessError } from "./workspace-identity";

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const workspaceDataFetch: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/rest/v1/")) return fetch(request);
  const token = request.headers.get("authorization")?.replace(/^Bearer /i, "") || "";
  const service = getServerServiceRoleSupabase();
  if (!service || !token) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
  const { data, error } = await service.auth.getUser(token);
  if (error || !data.user) throw new WorkspaceAccessError(403, "workspace_access_denied");
  const identity = await requireWorkspaceAccess({ userId: data.user.id });
  if (!identity) return fetch(request);
  await assertGoogleSession(token, identity.userId);
  const permit = randomBytes(32).toString("base64url");
  const hash = sha256(permit);
  const issued = await service.rpc("workspace_issue_permit", {
    p_hash: hash, p_user_id: identity.userId, p_jwt_hash: sha256(token), p_method: request.method,
    p_path: url.pathname.slice("/rest/v1".length),
  });
  if (issued.error) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
  request.headers.set("x-founderops-workspace-permit", permit);
  try { return await fetch(request); }
  finally {
    // Never replay the user operation when cleanup fails; permits also expire independently.
    await Promise.resolve(service.rpc("workspace_release_permit", { p_hash: hash })).catch(() => undefined);
  }
};
