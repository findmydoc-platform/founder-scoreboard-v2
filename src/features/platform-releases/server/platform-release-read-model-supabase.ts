import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { platformReleaseNotificationState, type PlatformReleaseManifest } from "../model/platform-release-manifest";
import { platformReleaseSeed } from "../model/platform-release-seed";
import { compareReleaseVersions, type PlatformReleasePlanningLink, type PlatformReleasePlanningReference, type PlatformReleaseRecord } from "../model/platform-release-model";

type ReleaseRow = {
  version: string;
  summary: string;
  published_at: string;
  manifest_digest: string;
  manifest: PlatformReleaseManifest;
};

type TaskRow = {
  id: string;
  title: string;
  task_type: "epic" | "initiative" | "deliverable" | "sub_issue";
  parent_task_id: string | null;
  github_repo: string | null;
  github_issue_number: number | null;
};

type TaskLinkRow = {
  task_id: string;
  metadata: Record<string, unknown> | null;
};

type NotificationRow = { id: number; entity_id: string; seen_at: string | null };

function localFallback() {
  return process.env.NODE_ENV === "development" ? platformReleaseSeed : [];
}

function planningHref(task: TaskRow) {
  return task.task_type === "initiative"
    ? `/initiatives/${encodeURIComponent(task.id)}`
    : `/tasks/${encodeURIComponent(task.id)}`;
}

function linkForTask(task: TaskRow): PlatformReleasePlanningLink | null {
  if (task.task_type !== "initiative" && task.task_type !== "deliverable" && task.task_type !== "sub_issue") return null;
  return { id: task.id, title: task.title, type: task.task_type, href: planningHref(task), ...(task.github_issue_number ? { issueNumber: task.github_issue_number } : {}) };
}

function collectTaskLineage(taskId: string, tasksById: Map<string, TaskRow>) {
  const links: PlatformReleasePlanningLink[] = [];
  const visited = new Set<string>();
  let task = tasksById.get(taskId) || null;
  while (task && !visited.has(task.id)) {
    visited.add(task.id);
    const link = linkForTask(task);
    if (link) links.push(link);
    task = task.parent_task_id ? tasksById.get(task.parent_task_id) || null : null;
  }
  return links;
}

function referenceKey(repository: string, number: number) {
  return `${repository.trim().toLowerCase()}#${number}`;
}

function derivePlanningReferences(manifest: PlatformReleaseManifest, tasks: TaskRow[], taskLinks: TaskLinkRow[]) {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const taskIdsByPr = new Map<string, string[]>();
  for (const link of taskLinks) {
    const repository = typeof link.metadata?.repository === "string" ? link.metadata.repository : "";
    const number = typeof link.metadata?.number === "number" ? link.metadata.number : Number(link.metadata?.number);
    if (!repository || !Number.isInteger(number) || number <= 0) continue;
    const key = referenceKey(repository, number);
    taskIdsByPr.set(key, [...(taskIdsByPr.get(key) || []), link.task_id]);
  }
  const tasksByIssue = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.github_repo || !task.github_issue_number) continue;
    const key = referenceKey(task.github_repo, task.github_issue_number);
    tasksByIssue.set(key, [...(tasksByIssue.get(key) || []), task.id]);
  }
  const fullPullRequests = new Map(manifest.components.flatMap((component) => component.pullRequests).map((pullRequest) => [referenceKey(pullRequest.repository, pullRequest.number), pullRequest]));
  const references = new Map<string, PlatformReleasePlanningReference>();
  for (const component of manifest.components) {
    for (const pullRequest of component.pullRequests) {
      const key = referenceKey(pullRequest.repository, pullRequest.number);
      let matchedTaskIds = taskIdsByPr.get(key) || [];
      if (!matchedTaskIds.length) {
        matchedTaskIds = (fullPullRequests.get(key)?.issues || []).flatMap((issue) => tasksByIssue.get(referenceKey(issue.repository, issue.number)) || []);
      }
      const taskLinksForReference = matchedTaskIds.flatMap((taskId) => collectTaskLineage(taskId, tasksById));
      const uniqueLinks = [...new Map(taskLinksForReference.map((link) => [link.id, link])).values()];
      references.set(key, {
        repository: pullRequest.repository,
        pullRequestNumber: pullRequest.number,
        taskLinks: uniqueLinks,
      });
    }
  }
  return [...references.values()];
}

export async function loadPlatformReleases(supabase: SupabaseClient, profileId?: string | null): Promise<PlatformReleaseRecord[]> {
  const [releaseResult, taskResult, linkResult, notificationResult] = await Promise.all([
    supabase.from("platform_releases").select("version,summary,published_at,manifest_digest,manifest").order("published_at", { ascending: false }).limit(200),
    supabase.from(ACTIVE_TASKS_TABLE).select("id,title,task_type,parent_task_id,github_repo,github_issue_number"),
    supabase.from("task_links").select("task_id,metadata").eq("type", "github_pull_request"),
    profileId
      ? supabase.from("notification_events").select("id,entity_id,seen_at").eq("recipient_profile_id", profileId).eq("entity_type", "platform_release")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (releaseResult.error) return localFallback();
  const tasks = taskResult.error ? [] : (taskResult.data || []) as TaskRow[];
  const taskLinks = linkResult.error ? [] : (linkResult.data || []) as TaskLinkRow[];
  const notifications = notificationResult.error ? [] : (notificationResult.data || []) as NotificationRow[];
  const notificationByVersion = new Map(notifications.map((notification) => [notification.entity_id, notification]));
  return ((releaseResult.data || []) as ReleaseRow[]).map((row) => {
    const notification = notificationByVersion.get(row.version);
    const notificationState = platformReleaseNotificationState(row.manifest, row.published_at, notification);
    return {
      version: row.version,
      summary: row.summary,
      publishedAt: row.published_at,
      manifestDigest: row.manifest_digest,
      manifest: row.manifest,
      planningReferences: derivePlanningReferences(row.manifest, tasks, taskLinks),
      ...notificationState,
    };
  }).sort((left, right) => compareReleaseVersions(left.version, right.version));
}

export async function loadPlatformRelease(supabase: SupabaseClient, version: string, profileId?: string | null) {
  const releases = await loadPlatformReleases(supabase, profileId);
  return releases.find((release) => release.version === version) || null;
}
