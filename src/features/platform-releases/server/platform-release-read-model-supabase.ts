import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { platformReleaseNotificationState, type PlatformReleaseManifest } from "../model/platform-release-manifest";
import { compareReleaseVersions, type PlatformReleaseRecord } from "../model/platform-release-model";

type ReleaseRow = {
  version: string;
  summary: string;
  published_at: string;
  manifest_digest: string;
  manifest: PlatformReleaseManifest;
};

type NotificationRow = { id: number; entity_id: string; seen_at: string | null };

type ReleaseContent = Omit<PlatformReleaseRecord, "planningReferences">;
const releaseColumns = "version,summary,published_at,manifest_digest,manifest";

function releaseContent(row: ReleaseRow, notification?: NotificationRow): ReleaseContent {
  return {
    version: row.version, summary: row.summary, publishedAt: row.published_at, manifestDigest: row.manifest_digest, manifest: row.manifest,
    ...platformReleaseNotificationState(row.manifest, row.published_at, notification),
  };
}

export async function loadPlatformReleaseDocumentContent(supabase: SupabaseClient, actor: {
  userId: string;
  profileId: string;
  platformRole: string;
}, version: string, signal: AbortSignal) {
  const result = await supabase.rpc("platform_release_document_snapshot", {
    p_version: version,
    p_user_id: actor.userId,
    p_profile_id: actor.profileId,
    p_platform_role: actor.platformRole,
  }).abortSignal(signal);
  if (result.status === 401 || result.status === 403 || result.data?.status === "forbidden") return { status: "forbidden" as const };
  if (signal.aborted) return { status: "unavailable" as const };
  if ((result.status === 404 && result.error?.code === "PGRST202") || (!result.error && result.data?.status === "legacy-required")) {
    return loadPlatformReleaseContent(supabase, actor.profileId, { version, signal });
  }
  if (result.error || result.data?.status !== "ready") return { status: "unavailable" as const };
  const row: ReleaseRow | null = result.data.release;
  const notification: NotificationRow | null = result.data.notification;
  if (row === null && notification === null) return { status: "ready" as const, releases: [] };
  if (row?.version !== version || notification === undefined || (notification !== null && notification.entity_id !== version)) {
    return { status: "unavailable" as const };
  }
  return { status: "ready" as const, releases: [releaseContent(row, notification ?? undefined)] };
}


export async function loadPlatformReleaseContent(supabase: SupabaseClient, profileId: string | null, options: { version?: string; signal?: AbortSignal } = {}) {
  const { version, signal } = options;
  let releaseQuery = supabase.from("platform_releases").select(releaseColumns);
  releaseQuery = version ? releaseQuery.eq("version", version).limit(1) : releaseQuery.order("published_at", { ascending: false }).limit(200);
  let notificationQuery = profileId ? supabase.from("notification_events").select("id,entity_id,seen_at")
    .eq("recipient_profile_id", profileId).eq("entity_type", "platform_release") : null;
  if (version && notificationQuery) notificationQuery = notificationQuery.eq("entity_id", version);
  if (signal) {
    releaseQuery = releaseQuery.abortSignal(signal);
    notificationQuery = notificationQuery?.abortSignal(signal) || null;
  }
  const [releaseResult, notificationResult] = await Promise.all([
    releaseQuery, notificationQuery || Promise.resolve({ status: 200, data: [], error: null }),
  ]);
  if ([releaseResult, notificationResult].some(result => result.status === 401 || result.status === 403)) return { status: "forbidden" as const };
  if (signal?.aborted || releaseResult.error || notificationResult.error
    || !Array.isArray(releaseResult.data) || !Array.isArray(notificationResult.data)) return { status: "unavailable" as const };
  const notifications = new Map((notificationResult.data as NotificationRow[]).map(notification => [notification.entity_id, notification]));
  const releases = (releaseResult.data as ReleaseRow[]).map(row => releaseContent(row, notifications.get(row.version)))
    .sort((left, right) => compareReleaseVersions(left.version, right.version));
  return { status: "ready" as const, releases };
}
