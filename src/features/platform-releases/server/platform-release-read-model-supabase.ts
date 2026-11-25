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
  const releases: ReleaseContent[] = (releaseResult.data as ReleaseRow[]).map(row => ({
    version: row.version, summary: row.summary, publishedAt: row.published_at, manifestDigest: row.manifest_digest, manifest: row.manifest,
    ...platformReleaseNotificationState(row.manifest, row.published_at, notifications.get(row.version)),
  })).sort((left, right) => compareReleaseVersions(left.version, right.version));
  return { status: "ready" as const, releases };
}
