import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type PlanningReleaseKey = { version: string; manifestDigest: string };

type ReleaseTaskLink = {
  id: string;
  title: string;
  type: "initiative" | "deliverable" | "sub_issue";
  href: string;
  issueNumber?: number;
};
type PlanningReleaseReference = { repository: string; pullRequestNumber: number; taskLinks: ReleaseTaskLink[] };

function readLinks(value: unknown) {
  if (!Array.isArray(value)) return null;
  const links: ReleaseTaskLink[] = [];
  for (const item of value) {
    if (!item || typeof item.id !== "string" || !item.id || typeof item.title !== "string"
      || (item.type !== "initiative" && item.type !== "deliverable" && item.type !== "sub_issue")
      || (item.issueNumber != null && !Number.isSafeInteger(item.issueNumber))) return null;
    links.push({
      id: item.id, title: item.title, type: item.type,
      href: `${item.type === "initiative" ? "/initiatives" : "/tasks"}/${encodeURIComponent(item.id)}`,
      ...(item.issueNumber ? { issueNumber: item.issueNumber } : {}),
    });
  }
  return links;
}

function readReferences(value: unknown) {
  if (!Array.isArray(value)) return null;
  const references: PlanningReleaseReference[] = [];
  for (const item of value) {
    if (!item || typeof item.repository !== "string" || !item.repository.trim() || !Number.isSafeInteger(item.pullRequestNumber) || item.pullRequestNumber <= 0) return null;
    const taskLinks = readLinks(item.taskLinks);
    if (taskLinks === null) return null;
    references.push({ repository: item.repository, pullRequestNumber: item.pullRequestNumber, taskLinks });
  }
  return references;
}

export async function readPlanningReleaseReferenceSnapshot(supabase: SupabaseClient, context: {
  userId: string; sessionId: string; profileId: string; platformRole: string; deadline: number;
  keys: readonly PlanningReleaseKey[]; signal: AbortSignal;
}) {
  const result = await supabase.rpc("planning_release_reference_snapshot", {
    p_user_id: context.userId,
    p_session_id: context.sessionId,
    p_profile_id: context.profileId,
    p_platform_role: context.platformRole,
    p_deadline: new Date(context.deadline).toISOString(),
    p_release_keys: context.keys,
  }).abortSignal(context.signal);
  if (result.status === 401 || result.status === 403 || result.data?.status === "forbidden") return { status: "forbidden" as const };
  if (context.signal.aborted || result.error || !result.data) return { status: "unavailable" as const };
  if (result.data.status === "stale") return { status: "stale" as const };
  if (result.data.status !== "ready" || typeof result.data.source_revision !== "string" || !result.data.source_revision
    || !Array.isArray(result.data.releases) || result.data.releases.length !== context.keys.length) return { status: "unavailable" as const };
  const releases: Array<PlanningReleaseKey & { planningReferences: PlanningReleaseReference[] }> = [];
  for (let index = 0; index < context.keys.length; index++) {
    const key = context.keys[index];
    const row = result.data.releases[index];
    if (!row || row.version !== key.version || row.manifestDigest !== key.manifestDigest) return { status: "unavailable" as const };
    const planningReferences = readReferences(row.planningReferences);
    if (planningReferences === null) return { status: "unavailable" as const };
    releases.push({ ...key, planningReferences });
  }
  return { status: "ready" as const, sourceRevision: result.data.source_revision as string, releases };
}
