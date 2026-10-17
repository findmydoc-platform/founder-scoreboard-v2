import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { WorkspaceAccessError, workspaceIdentity } from "@/lib/workspace-identity";
import { isWorkspaceGroupMember } from "../workspace-directory";

const evidence = new Map<string, number>();
const pending = new Map<string, Promise<void>>();
const unavailable = () => new WorkspaceAccessError(503, "workspace_access_unavailable");
const denied = () => new WorkspaceAccessError(403, "workspace_access_denied");

export async function authorizePersonalTokenWorkspace(service: SupabaseClient, profileId: string, tokenHash: string, scope: string, grantedScopes: readonly string[], startedAt: number, expiresAt: number) {
  // Owner binding, linked identity and admission mode remain live on every use.
  const result = await service.rpc("workspace_access_context", { p_user_id: null, p_profile_id: profileId });
  const context = result.data;
  if (result.error || !context || !["legacy", "linking", "google"].includes(context.mode)) throw unavailable();
  if (context.mode === "legacy" || (context.mode === "linking" && !context.linkingEnforced)) return;
  if (context.mode === "linking" && context.profileId && !context.linked) throw new WorkspaceAccessError(403, "workspace_link_required");
  if (context.profileId !== profileId || !context.userId || !context.linked || !context.identity) throw denied();
  const identity = workspaceIdentity({ id: context.userId, identities: [{ provider: "google", identity_data: context.identity }] });
  const key = createHash("sha256").update(JSON.stringify(["personal-planning-token", tokenHash, profileId, context.userId,
    identity.subject, identity.email, scope, [...grantedScopes].sort(), context.mode, context.linkingEnforced,
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL, process.env.GOOGLE_AUTHORIZED_GROUP,
    process.env.GOOGLE_WORKLOAD_IDENTITY_AUDIENCE, process.env.GOOGLE_WORKSPACE_SERVICE_ACCOUNT, "personal-token-policy-v1"])).digest("hex");
  for (const [key, deadline] of evidence) if (Date.now() >= deadline) evidence.delete(key);
  if (evidence.has(key)) return;
  const running = pending.get(key);
  if (running) {
    await running;
    if (!evidence.has(key) || Date.now() >= evidence.get(key)!) throw unavailable();
    return;
  }
  const verification = (async () => {
    let member: boolean;
    try { member = await isWorkspaceGroupMember(identity.email); } catch { throw unavailable(); }
    if (!member) throw denied();
    const deadline = Math.min(startedAt + 900_000, expiresAt);
    if (Date.now() >= deadline) throw unavailable();
    if (evidence.size >= 1024) evidence.delete(evidence.keys().next().value!);
    evidence.set(key, deadline);
  })();
  pending.set(key, verification);
  try { await verification; } finally { if (pending.get(key) === verification) pending.delete(key); }
}
