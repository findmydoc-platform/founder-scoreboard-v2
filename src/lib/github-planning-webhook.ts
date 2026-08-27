import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPlanningItemUpdatePreview,
  createBrowserRevisePlanningItems,
  parsePlanningItemPatchPayload,
  planningItemReviseCommand,
  type PlanningItemUpdatePreview,
} from "@/features/planning-items/model/planning-item-update";
import { dispatchPlanningGitHubProjections } from "@/features/planning-items/model/planning-items-github-projection";
import {
  createPlanningReviewPlanningItems,
  requestPlanningReviewCommand,
} from "@/features/planning-items/model/planning-items-review";
import {
  changePlanningParentCommand,
  createPlanningReparentPlanningItems,
} from "@/features/planning-items/model/planning-items-reparent";
import {
  addPlanningRelationshipCommand,
  createPlanningRelationshipPlanningItems,
  removePlanningRelationshipCommand,
} from "@/features/planning-items/model/planning-items-relationships";
import type { ActorContext, PlatformRole } from "@/features/planning-items/model/actor-context";
import type { AuthenticatedProfile } from "@/lib/types";
import { getGitHubIssue } from "./github";
import { getGitHubAppInstallationToken } from "./github-app";
import {
  loadGitHubPlanningIssueFieldObservation,
  loadGitHubPlanningProjectObservation,
  type GitHubPlanningProjectObservation,
} from "./github-sync/project-observation";
import {
  loadGitHubDependencyObservation,
  loadGitHubSubIssueParentObservation,
  type GitHubSubIssueParentObservation,
} from "./github-sync/relationship-observation";
import {
  decideGitHubIssueFieldPlanningChange,
  decideGitHubIssuePlanningChange,
  decideGitHubProjectPlanningChange,
  isFounderOpsManagedGitHubIssueField,
  type GitHubPlanningIssueDelivery,
  type GitHubPlanningIssueSnapshot,
  type GitHubPlanningTaskSnapshot,
} from "./github-planning-webhook-policy";

type PlanningEventName = "issues" | "sub_issues" | "issue_dependencies" | "projects_v2_item";
type FinalStatus = "processed" | "ignored" | "retry_scheduled" | "failed";

export type ClaimedGitHubPlanningDelivery = Readonly<{
  deliveryId: string;
  eventName: PlanningEventName;
  action: string;
  repositoryFullName: string;
  issueId: number | null;
  issueNodeId: string;
  issueNumber: number;
  issueUpdatedAt: string;
  relatedRepositoryFullName: string;
  relatedIssueId: number | null;
  relatedIssueNodeId: string;
  relatedIssueNumber: number | null;
  relatedIssueUpdatedAt: string;
  projectNodeId: string;
  projectItemNodeId: string;
  projectItemUpdatedAt: string;
  projectContentNodeId: string;
  projectFieldNodeId: string;
  changedFields: readonly string[];
  targetUserId: number | null;
  senderId: number | null;
  senderType: string;
  attempts: number;
}>;

export type GitHubPlanningActor = Readonly<{
  profileId: string;
  name: string;
  platformRole: Exclude<PlatformRole, "viewer">;
}>;

type TaskMapping =
  | Readonly<{ kind: "found"; taskId: string }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "ambiguous" }>;

type BlockedByRelationship = Readonly<{ id: number }>;

type FinalizeInput = Readonly<{
  status: FinalStatus;
  statusReason: string;
  lastError?: string;
  availableAt?: string;
}>;

type ProjectionState = Readonly<{
  total: number;
  completed: number;
  outstanding: number;
  failed: number;
  availableAt: string | null;
  lastError: string | null;
}>;

export type GitHubPlanningWebhookStore = Readonly<{
  claim(deliveryId: string, lockToken: string): Promise<ClaimedGitHubPlanningDelivery | null>;
  resolveTask(repository: string, issueNumber: number): Promise<TaskMapping>;
  resolveSprint(title: string, startDate: string): Promise<TaskMapping>;
  resolveActor(githubUserId: number | null): Promise<GitHubPlanningActor | null>;
  loadTask(taskId: string): Promise<GitHubPlanningTaskSnapshot | null>;
  findBlockedByRelationship(taskId: string, relatedTaskId: string): Promise<BlockedByRelationship | null>;
  enqueueProjection(
    deliveryId: string,
    lockToken: string,
    taskId: string,
    observedIssue?: Readonly<{ repositoryFullName: string; issueNumber: number }>,
  ): Promise<string>;
  loadProjectionState(deliveryId: string): Promise<ProjectionState>;
  finalize(deliveryId: string, lockToken: string, input: FinalizeInput): Promise<boolean>;
}>;

export type GitHubPlanningWebhookResult =
  | Readonly<{ kind: "skipped" }>
  | Readonly<{ kind: "processed"; reason: "founderops_updated" | "corrected_in_github" }>
  | Readonly<{ kind: "ignored"; reason: "task_not_found" | "app_projection" | "unowned_change" | "already_aligned" | "superseded" }>
  | Readonly<{ kind: "retry_scheduled" | "failed"; reason: "processing_error" | "ambiguous_task_mapping" }>;

type IssueLoader = (delivery: ClaimedGitHubPlanningDelivery) => Promise<GitHubPlanningIssueSnapshot>;
type IssueFieldLoader = (
  delivery: ClaimedGitHubPlanningDelivery,
  fieldName: string,
) => Promise<Readonly<{
  fieldName: string;
  fieldValue: GitHubPlanningProjectObservation["changedFieldValue"];
}>>;
type ProjectLoader = (delivery: ClaimedGitHubPlanningDelivery) => Promise<GitHubPlanningProjectObservation>;
type RelationshipObservation =
  | Readonly<{
      kind: "sub_issue";
      parent: GitHubSubIssueParentObservation;
      primaryUpdatedAt: string;
      relatedUpdatedAt: string;
    }>
  | Readonly<{
      kind: "dependency";
      exists: boolean;
      primaryUpdatedAt: string;
      relatedUpdatedAt: string;
    }>;
type RelationshipLoader = (delivery: ClaimedGitHubPlanningDelivery) => Promise<RelationshipObservation>;

function changedIssueFieldName(delivery: ClaimedGitHubPlanningDelivery) {
  return delivery.changedFields
    .find((candidate) => candidate.startsWith("issue_field:"))
    ?.slice("issue_field:".length)
    .trim() || "";
}

function positiveSafeInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sameTimestamp(left: string, right: string) {
  return Date.parse(left) === Date.parse(right);
}

function planningEventName(value: unknown): PlanningEventName | null {
  return value === "issues" || value === "sub_issues" || value === "issue_dependencies" || value === "projects_v2_item"
    ? value
    : null;
}

function claimedDelivery(value: unknown): ClaimedGitHubPlanningDelivery | null {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!row) return null;
  const eventName = planningEventName(row.event_name);
  const deliveryId = text(row.delivery_id);
  const action = text(row.action);
  const repositoryFullName = text(row.repository_full_name);
  const issueId = positiveSafeInteger(row.issue_id);
  const issueNodeId = text(row.issue_node_id);
  const issueNumber = positiveSafeInteger(row.issue_number);
  const issueUpdatedAt = text(row.issue_updated_at);
  const relatedRepositoryFullName = text(row.related_repository_full_name);
  const relatedIssueId = positiveSafeInteger(row.related_issue_id);
  const relatedIssueNodeId = text(row.related_issue_node_id);
  const relatedIssueNumber = positiveSafeInteger(row.related_issue_number);
  const relatedIssueUpdatedAt = text(row.related_issue_updated_at);
  const projectItemUpdatedAt = text(row.project_item_updated_at);
  const attempts = positiveSafeInteger(row.attempts);
  if (!eventName || !deliveryId || !action || !attempts) {
    throw new Error("Claimed GitHub planning delivery is invalid.");
  }
  if (eventName === "issues" && (
    !repositoryFullName
    || !issueId
    || !issueNodeId
    || !issueNumber
    || !issueUpdatedAt
    || Number.isNaN(Date.parse(issueUpdatedAt))
  )) {
    throw new Error("Claimed GitHub Issue planning delivery is invalid.");
  }
  if (eventName === "projects_v2_item" && (
    !text(row.project_node_id)
    || !text(row.project_item_node_id)
    || !projectItemUpdatedAt
    || Number.isNaN(Date.parse(projectItemUpdatedAt))
    || !text(row.project_content_node_id)
    || (action === "edited" && !text(row.project_field_node_id))
  )) {
    throw new Error("Claimed GitHub Project planning delivery is invalid.");
  }
  if ((eventName === "sub_issues" || eventName === "issue_dependencies") && (
    !repositoryFullName
    || !issueId
    || !issueNodeId
    || !issueNumber
    || !relatedRepositoryFullName
    || !relatedIssueId
    || !relatedIssueNodeId
    || !relatedIssueNumber
    || !issueUpdatedAt
    || Number.isNaN(Date.parse(issueUpdatedAt))
    || !relatedIssueUpdatedAt
    || Number.isNaN(Date.parse(relatedIssueUpdatedAt))
  )) {
    throw new Error("Claimed GitHub relationship planning delivery is invalid.");
  }
  return {
    deliveryId,
    eventName,
    action,
    repositoryFullName,
    issueId,
    issueNodeId,
    issueNumber: issueNumber || 0,
    issueUpdatedAt,
    relatedRepositoryFullName,
    relatedIssueId,
    relatedIssueNodeId,
    relatedIssueNumber,
    relatedIssueUpdatedAt,
    projectNodeId: text(row.project_node_id),
    projectItemNodeId: text(row.project_item_node_id),
    projectItemUpdatedAt,
    projectContentNodeId: text(row.project_content_node_id),
    projectFieldNodeId: text(row.project_field_node_id),
    changedFields: Array.isArray(row.changed_fields)
      ? row.changed_fields.map(text).filter(Boolean).slice(0, 20)
      : [],
    targetUserId: positiveSafeInteger(row.target_user_id),
    senderId: positiveSafeInteger(row.sender_id),
    senderType: text(row.sender_type),
    attempts,
  };
}

function taskSnapshot(value: unknown): GitHubPlanningTaskSnapshot | null {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!row) return null;
  const taskType = row.task_type === "sub_issue" ? "sub_issue" : row.task_type === "deliverable" ? "deliverable" : null;
  const id = text(row.id);
  const updatedAt = text(row.updated_at);
  if (!id || !taskType || !updatedAt || Number.isNaN(Date.parse(updatedAt))) return null;
  const evidenceLinks = Array.isArray(row.evidence_links)
    ? row.evidence_links.map(text).filter(Boolean)
    : [];
  const evidenceLink = evidenceLinks[0] || text(row.evidence_link);
  return {
    id,
    taskType,
    updatedAt,
    title: text(row.title),
    description: text(row.description),
    problemStatement: text(row.problem_statement),
    intendedOutcome: text(row.intended_outcome),
    scopeConstraints: text(row.scope_constraints),
    acceptanceCriteria: text(row.acceptance_criteria),
    evidenceRequired: text(row.evidence_required),
    definitionOfDone: text(row.definition_of_done),
    status: text(row.status),
    priority: text(row.priority),
    workstream: text(row.workstream),
    hours: Number(row.estimate_hours || 0),
    evidenceLink,
    evidenceLinks: evidenceLinks.length ? evidenceLinks : evidenceLink ? [evidenceLink] : [],
    fixedDate: text(row.fixed_date),
    sprintId: text(row.sprint_id),
    ownerId: text(row.owner) || text(row.assignee),
    parentTaskId: text(row.parent_task_id),
    reviewStatus: text(row.review_status) || "not_requested",
    scoreFinal: Boolean(row.score_final),
  };
}

function actor(value: unknown): GitHubPlanningActor | null {
  const row = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
  if (!row) return null;
  const profileId = text(row.profile_id);
  const name = text(row.profile_name);
  const platformRole = row.platform_role;
  return profileId && name && (platformRole === "ceo" || platformRole === "deputy" || platformRole === "founder")
    ? { profileId, name, platformRole }
    : null;
}

export function createSupabaseGitHubPlanningWebhookStore(
  supabase: SupabaseClient,
): GitHubPlanningWebhookStore {
  return {
    async claim(deliveryId, lockToken) {
      const { data, error } = await supabase.rpc("claim_github_planning_webhook_delivery", {
        p_delivery_id: deliveryId,
        p_lock_token: lockToken,
        p_lease_seconds: 120,
      });
      if (error) throw new Error(`GitHub planning delivery could not be claimed: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      return claimedDelivery(row);
    },

    async resolveTask(repository, issueNumber) {
      const { data, error } = await supabase.rpc("resolve_github_planning_webhook_tasks", {
        p_repository_full_name: repository,
        p_issue_number: issueNumber,
      });
      if (error) throw new Error(`GitHub planning task mapping could not be loaded: ${error.message}`);
      const rows = (data || []) as Array<{ task_id?: unknown }>;
      if (!rows.length) return { kind: "missing" };
      if (rows.length > 1) return { kind: "ambiguous" };
      const taskId = text(rows[0]?.task_id);
      if (!taskId) throw new Error("GitHub planning task mapping is invalid.");
      return { kind: "found", taskId };
    },

    async resolveSprint(title, startDate) {
      const { data, error } = await supabase
        .from("sprints")
        .select("id")
        .eq("name", title)
        .eq("start_date", startDate)
        .limit(2);
      if (error) throw new Error(`FounderOps Sprint mapping could not be loaded: ${error.message}`);
      const rows = (data || []) as Array<{ id?: unknown }>;
      if (!rows.length) return { kind: "missing" };
      if (rows.length > 1) return { kind: "ambiguous" };
      const sprintId = text(rows[0]?.id);
      if (!sprintId) throw new Error("FounderOps Sprint mapping is invalid.");
      return { kind: "found", taskId: sprintId };
    },

    async resolveActor(githubUserId) {
      if (!githubUserId) return null;
      const { data, error } = await supabase.rpc("resolve_github_planning_webhook_actor", {
        p_github_user_id: githubUserId,
      });
      if (error) throw new Error(`GitHub planning actor could not be loaded: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      return actor(row);
    },

    async loadTask(taskId) {
      const [taskResult, evidenceLinksResult] = await Promise.all([
        supabase
          .from("tasks")
          .select("id,task_type,title,description,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,evidence_link,definition_of_done,status,priority,workstream,estimate_hours,fixed_date,sprint_id,owner,assignee,parent_task_id,review_status,score_final,updated_at")
          .eq("id", taskId)
          .is("trashed_at", null)
          .maybeSingle(),
        supabase
          .from("task_links")
          .select("url,position,id")
          .eq("task_id", taskId)
          .eq("type", "evidence")
          .order("position")
          .order("id"),
      ]);
      if (taskResult.error) throw new Error(`FounderOps planning task could not be loaded: ${taskResult.error.message}`);
      if (evidenceLinksResult.error) throw new Error(`FounderOps task evidence links could not be loaded: ${evidenceLinksResult.error.message}`);
      return taskSnapshot({
        ...(taskResult.data || {}),
        evidence_links: (evidenceLinksResult.data || []).map((link: { url?: unknown }) => text(link.url)).filter(Boolean),
      });
    },

    async findBlockedByRelationship(taskId, relatedTaskId) {
      const { data, error } = await supabase
        .from("task_relationship_edges")
        .select("id")
        .eq("task_id", taskId)
        .eq("related_task_id", relatedTaskId)
        .eq("relation_type", "blocked_by")
        .maybeSingle<{ id: number }>();
      if (error) throw new Error(`FounderOps dependency could not be loaded: ${error.message}`);
      return data && Number.isSafeInteger(data.id) && data.id > 0 ? { id: data.id } : null;
    },

    async enqueueProjection(deliveryId, lockToken, taskId, observedIssue) {
      const { data, error } = await supabase.rpc("enqueue_github_webhook_planning_projection", {
        p_delivery_id: deliveryId,
        p_lock_token: lockToken,
        p_task_id: taskId,
        p_observed_repository_full_name: observedIssue?.repositoryFullName || null,
        p_observed_issue_number: observedIssue?.issueNumber || null,
      });
      if (error) throw new Error(`Corrective GitHub projection could not be queued: ${error.message}`);
      const operationId = text((data as { planning_operation_id?: unknown } | null)?.planning_operation_id);
      if (!operationId) throw new Error("Corrective GitHub projection returned no operation id.");
      return operationId;
    },

    async loadProjectionState(deliveryId) {
      const { data, error } = await supabase
        .from("planning_github_projection_outbox")
        .select("status,available_at,locked_at,last_error")
        .eq("source_delivery_id", deliveryId);
      if (error) throw new Error(`Corrective GitHub projection state could not be loaded: ${error.message}`);
      const rows = (data || []) as Array<{
        status?: unknown;
        available_at?: unknown;
        locked_at?: unknown;
        last_error?: unknown;
      }>;
      let completed = 0;
      let outstanding = 0;
      let failed = 0;
      let lastError: string | null = null;
      const availableTimes: number[] = [];
      for (const row of rows) {
        const status = text(row.status);
        if (status === "completed") {
          completed += 1;
          continue;
        }
        if (status === "failed") {
          failed += 1;
          lastError ||= text(row.last_error) || null;
          continue;
        }
        if (status !== "pending" && status !== "processing" && status !== "retry_scheduled") {
          throw new Error("Corrective GitHub projection state is invalid.");
        }
        outstanding += 1;
        const timestamp = status === "processing"
          ? Date.parse(text(row.locked_at)) + 120_000
          : Date.parse(text(row.available_at));
        if (Number.isFinite(timestamp)) availableTimes.push(timestamp);
        lastError ||= text(row.last_error) || null;
      }
      const availableAt = availableTimes.length
        ? new Date(Math.max(Date.now() + 60_000, Math.min(...availableTimes))).toISOString()
        : null;
      return { total: rows.length, completed, outstanding, failed, availableAt, lastError };
    },

    async finalize(deliveryId, lockToken, input) {
      const { data, error } = await supabase.rpc("finalize_github_planning_webhook_delivery", {
        p_delivery_id: deliveryId,
        p_lock_token: lockToken,
        p_status: input.status,
        p_status_reason: input.statusReason,
        p_last_error: input.lastError || null,
        p_available_at: input.availableAt || null,
      });
      if (error) throw new Error(`GitHub planning delivery could not be finalized: ${error.message}`);
      return data === true;
    },
  };
}

async function loadCurrentGitHubIssue(
  delivery: ClaimedGitHubPlanningDelivery,
): Promise<GitHubPlanningIssueSnapshot> {
  const token = await getGitHubAppInstallationToken();
  const issue = await getGitHubIssue(delivery.issueNumber, token, delivery.repositoryFullName);
  const nodeId = text(issue.node_id);
  const title = text(issue.title);
  const updatedAt = text(issue.updated_at);
  const state = issue.state === "closed" ? "closed" : issue.state === "open" ? "open" : null;
  if (
    issue.id !== delivery.issueId
    || issue.number !== delivery.issueNumber
    || nodeId !== delivery.issueNodeId
    || !title
    || !updatedAt
    || Number.isNaN(Date.parse(updatedAt))
    || !state
    || issue.pull_request
  ) {
    throw new Error("Reloaded GitHub Issue identity does not match the verified delivery.");
  }
  return {
    id: issue.id,
    nodeId,
    number: issue.number,
    title,
    body: typeof issue.body === "string" ? issue.body : "",
    state,
    labels: (issue.labels || []).flatMap((label) => {
      const name = typeof label === "string" ? label : label?.name;
      return typeof name === "string" && name.trim() ? [name.trim()] : [];
    }),
    assigneeUserIds: (issue.assignees || []).flatMap((assignee) => {
      const id = positiveSafeInteger(assignee.id);
      return id ? [id] : [];
    }),
    updatedAt,
  };
}

async function loadCurrentGitHubRelationship(
  delivery: ClaimedGitHubPlanningDelivery,
): Promise<RelationshipObservation> {
  const token = await getGitHubAppInstallationToken();
  const loadVersion = async ({
    repositoryFullName,
    issueNumber,
    issueId,
    issueNodeId,
  }: {
    repositoryFullName: string;
    issueNumber: number;
    issueId: number;
    issueNodeId: string;
  }) => {
    const issue = await getGitHubIssue(issueNumber, token, repositoryFullName);
    const updatedAt = text(issue.updated_at);
    if (
      issue.id !== issueId
      || issue.number !== issueNumber
      || text(issue.node_id) !== issueNodeId
      || !updatedAt
      || Number.isNaN(Date.parse(updatedAt))
      || issue.pull_request
    ) {
      throw new Error("Reloaded GitHub relationship Issue identity does not match the verified delivery.");
    }
    return updatedAt;
  };
  const primaryVersion = loadVersion({
    repositoryFullName: delivery.repositoryFullName,
    issueNumber: delivery.issueNumber,
    issueId: delivery.issueId || 0,
    issueNodeId: delivery.issueNodeId,
  });
  const relatedVersion = loadVersion({
    repositoryFullName: delivery.relatedRepositoryFullName,
    issueNumber: delivery.relatedIssueNumber || 0,
    issueId: delivery.relatedIssueId || 0,
    issueNodeId: delivery.relatedIssueNodeId,
  });
  if (delivery.eventName === "sub_issues") {
    const [primaryUpdatedAt, relatedUpdatedAt, parent] = await Promise.all([
      primaryVersion,
      relatedVersion,
      loadGitHubSubIssueParentObservation({
        childRepositoryFullName: delivery.relatedRepositoryFullName,
        childIssueNumber: delivery.relatedIssueNumber || 0,
        childIssueNodeId: delivery.relatedIssueNodeId,
        token,
      }),
    ]);
    return {
      kind: "sub_issue",
      parent,
      primaryUpdatedAt,
      relatedUpdatedAt,
    };
  }
  if (delivery.eventName === "issue_dependencies") {
    const [primaryUpdatedAt, relatedUpdatedAt, exists] = await Promise.all([
      primaryVersion,
      relatedVersion,
      loadGitHubDependencyObservation({
        blockedRepositoryFullName: delivery.repositoryFullName,
        blockedIssueNumber: delivery.issueNumber,
        blockingRepositoryFullName: delivery.relatedRepositoryFullName,
        blockingIssueNumber: delivery.relatedIssueNumber || 0,
        token,
      }),
    ]);
    return {
      kind: "dependency",
      exists,
      primaryUpdatedAt,
      relatedUpdatedAt,
    };
  }
  throw new Error("GitHub relationship observation received an unsupported event.");
}

function retryAt(attempts: number) {
  const delaySeconds = Math.min(60 * 60, 60 * (2 ** Math.min(attempts, 6)));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

class ProjectionDeliveryError extends Error {
  constructor(
    message: string,
    readonly terminal: boolean,
    readonly availableAt: string | null = null,
  ) {
    super(message);
    this.name = "ProjectionDeliveryError";
  }
}

async function finalizeOrThrow(
  store: GitHubPlanningWebhookStore,
  deliveryId: string,
  lockToken: string,
  input: FinalizeInput,
) {
  if (!await store.finalize(deliveryId, lockToken, input)) {
    throw new Error("GitHub planning delivery lock expired before finalization.");
  }
}

function actorContext(value: GitHubPlanningActor): ActorContext {
  return {
    profileId: value.profileId,
    platformRole: value.platformRole,
    credential: { kind: "session" },
  };
}

function authenticatedProfile(value: GitHubPlanningActor): AuthenticatedProfile {
  return {
    id: value.profileId,
    name: value.name,
    platformRole: value.platformRole,
  } as AuthenticatedProfile;
}

function browserTaskPatch(
  preview: PlanningItemUpdatePreview,
) {
  const patch = { ...preview.dbPatch } as Record<string, unknown>;
  const effectColumns: Record<string, string> = {
    scoreFinal: "score_final",
    scorePoints: "score_points",
    reviewStatus: "review_status",
    reviewOwnerProfileId: "review_owner_profile_id",
    reviewRequestedAt: "review_requested_at",
    githubIssueSyncStatus: "github_issue_sync_status",
  };
  for (const effect of preview.systemEffects) {
    const column = effectColumns[effect.field];
    if (column) patch[column] = effect.after === "" ? null : effect.after;
  }
  if (preview.changedFields.length) {
    patch.github_issue_sync_status = "not_synced";
    patch.github_issue_sync_error = null;
  }
  return patch;
}

async function applyTaskUpdate(
  supabase: SupabaseClient,
  task: GitHubPlanningTaskSnapshot,
  actorValue: GitHubPlanningActor,
  patch: Readonly<Record<string, unknown>>,
) {
  const parsed = parsePlanningItemPatchPayload(
    { expectedUpdatedAt: task.updatedAt, ...patch },
    { allowWebhookProjectionFields: true },
  );
  if (!parsed.ok) return false;
  const prepared = await buildPlanningItemUpdatePreview({
    actor: authenticatedProfile(actorValue),
    itemId: task.id,
    parsed,
    supabase,
  });
  if (!prepared.ok || prepared.preview.errors.length) return false;
  if (!prepared.preview.changedFields.length) return true;
  const context = actorContext(actorValue);
  const activities = prepared.preview.systemEffects.flatMap((effect) => {
    const after = effect.after && typeof effect.after === "object" && !Array.isArray(effect.after)
      ? effect.after as Record<string, unknown>
      : null;
    return effect.field === "activity" && typeof after?.message === "string" ? [after.message] : [];
  });
  const taskPatch = browserTaskPatch(prepared.preview);
  if (prepared.preview.changedFields.includes("evidenceLink")) {
    const evidenceLink = text(prepared.preview.normalizedPatch.evidenceLink);
    taskPatch.evidence_link = evidenceLink || null;
    taskPatch.evidence_links = evidenceLink ? [evidenceLink] : [];
  }
  const result = await createBrowserRevisePlanningItems({
    supabase,
    actor: context,
    writer: {
      kind: "delivery",
      params: {
        taskId: task.id,
        expectedUpdatedAt: task.updatedAt,
        taskPatch,
        notePresent: false,
        note: null,
        dependencyPresent: false,
        dependencyNote: null,
        activityMessages: activities,
        notifications: [],
      },
    },
  }).run({
    actor: context,
    mode: "commit",
    command: planningItemReviseCommand(
      task.id,
      task.taskType,
      task.updatedAt,
      prepared.preview.normalizedPatch,
    ),
  });
  if (!result.ok) {
    if (result.error.code === "dependencyUnavailable") throw new Error("FounderOps planning update dependency is unavailable.");
    return false;
  }
  return result.status === "committed";
}

async function requestReview(
  supabase: SupabaseClient,
  task: GitHubPlanningTaskSnapshot,
  actorValue: GitHubPlanningActor,
) {
  const context = actorContext(actorValue);
  const result = await createPlanningReviewPlanningItems(supabase).run({
    actor: context,
    mode: "commit",
    command: requestPlanningReviewCommand(task.id, { expectedUpdatedAt: task.updatedAt }),
  });
  if (!result.ok) {
    if (result.error.code === "dependencyUnavailable") throw new Error("FounderOps review dependency is unavailable.");
    return false;
  }
  return result.status === "committed";
}

async function applySubIssueRelationship(
  supabase: SupabaseClient,
  child: GitHubPlanningTaskSnapshot,
  parent: GitHubPlanningTaskSnapshot,
  actorValue: GitHubPlanningActor,
) {
  if (child.taskType !== "sub_issue" || parent.taskType !== "deliverable") return false;
  const result = await createPlanningReparentPlanningItems(supabase, "sub_issue").run({
    actor: actorContext(actorValue),
    mode: "commit",
    command: changePlanningParentCommand(child.id, parent.id, child.updatedAt),
  });
  if (!result.ok) {
    if (result.error.code === "dependencyUnavailable") throw new Error("FounderOps reparent dependency is unavailable.");
    return false;
  }
  return result.status === "committed";
}

async function applyDependencyRelationship(
  supabase: SupabaseClient,
  blockedTask: GitHubPlanningTaskSnapshot,
  blockingTask: GitHubPlanningTaskSnapshot,
  relationship: BlockedByRelationship | null,
  actorValue: GitHubPlanningActor,
  operation: "add" | "remove",
) {
  if (operation === "add" && relationship) return true;
  if (operation === "remove" && !relationship) return true;
  const command = operation === "add"
    ? addPlanningRelationshipCommand(blockedTask.id, {
        relationType: "blocked_by",
        relatedTaskId: blockingTask.id,
        note: "",
        expectedUpdatedAt: blockedTask.updatedAt,
      })
    : removePlanningRelationshipCommand(blockedTask.id, {
        relationId: relationship!.id,
        expectedUpdatedAt: blockedTask.updatedAt,
      });
  const result = await createPlanningRelationshipPlanningItems(supabase).run({
    actor: actorContext(actorValue),
    mode: "commit",
    command,
  });
  if (!result.ok) {
    if (result.error.code === "dependencyUnavailable") throw new Error("FounderOps relationship dependency is unavailable.");
    return false;
  }
  return result.status === "committed";
}

async function enqueueTasksAndDispatch(
  supabase: SupabaseClient,
  store: GitHubPlanningWebhookStore,
  delivery: ClaimedGitHubPlanningDelivery,
  lockToken: string,
  taskIds: readonly string[],
  observedIssue?: Readonly<{ repositoryFullName: string; issueNumber: number }>,
) {
  const uniqueTaskIds = [...new Set(taskIds)];
  let operationId = "";
  for (const taskId of uniqueTaskIds) {
    const enqueuedOperationId = await store.enqueueProjection(
      delivery.deliveryId,
      lockToken,
      taskId,
      observedIssue,
    );
    if (operationId && enqueuedOperationId !== operationId) {
      throw new Error("Corrective GitHub projections returned different operation ids.");
    }
    operationId = enqueuedOperationId;
  }
  if (!operationId) throw new Error("Corrective GitHub projection has no task.");
  await dispatchPlanningGitHubProjections({ supabase, operationId });
  const state = await store.loadProjectionState(delivery.deliveryId);
  if (state.total !== uniqueTaskIds.length) {
    throw new Error("Corrective GitHub projection state does not cover every task.");
  }
  if (state.failed) {
    throw new ProjectionDeliveryError(
      state.lastError || "Corrective GitHub projection failed permanently.",
      true,
    );
  }
  if (state.outstanding) {
    throw new ProjectionDeliveryError(
      state.lastError || "Corrective GitHub projection is still pending.",
      false,
      state.availableAt,
    );
  }
  if (state.completed !== state.total) {
    throw new Error("Corrective GitHub projection state is incomplete.");
  }
}

async function processProjectDelivery({
  delivery,
  lockToken,
  store,
  supabase,
  loadProject,
}: {
  delivery: ClaimedGitHubPlanningDelivery;
  lockToken: string;
  store: GitHubPlanningWebhookStore;
  supabase: SupabaseClient;
  loadProject: ProjectLoader;
}): Promise<GitHubPlanningWebhookResult> {
  if (delivery.action === "reordered") {
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "ignored",
      statusReason: "unowned_change",
    });
    return { kind: "ignored", reason: "unowned_change" };
  }

  const project = await loadProject(delivery);
  const observedIssue = {
    repositoryFullName: project.repositoryFullName,
    issueNumber: project.issueNumber,
  };
  const mapping = await store.resolveTask(project.repositoryFullName, project.issueNumber);
  if (mapping.kind === "ambiguous") {
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "failed",
      statusReason: "ambiguous_task_mapping",
      lastError: "More than one FounderOps task references the GitHub Project Issue.",
    });
    return { kind: "failed", reason: "ambiguous_task_mapping" };
  }
  if (mapping.kind === "missing") {
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "ignored",
      statusReason: "task_not_found",
    });
    return { kind: "ignored", reason: "task_not_found" };
  }
  const task = await store.loadTask(mapping.taskId);
  if (!task) throw new Error("FounderOps task disappeared after GitHub Project mapping.");

  if (
    delivery.action === "edited"
    && (
      !project.projectItemActive
      || !project.projectItemUpdatedAt
      || !sameTimestamp(project.projectItemUpdatedAt, delivery.projectItemUpdatedAt)
    )
  ) {
    await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [task.id], observedIssue);
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "processed",
      statusReason: "superseded",
    });
    return { kind: "processed", reason: "corrected_in_github" };
  }

  let resolvedSprintId: string | null | undefined;
  if (project.changedFieldName === "Sprint") {
    if (project.changedFieldValue === null) {
      resolvedSprintId = null;
    } else if (
      typeof project.changedFieldValue === "object"
      && "title" in project.changedFieldValue
      && "startDate" in project.changedFieldValue
    ) {
      const sprint = await store.resolveSprint(
        project.changedFieldValue.title,
        project.changedFieldValue.startDate,
      );
      resolvedSprintId = sprint.kind === "found" ? sprint.taskId : undefined;
    }
  }
  const decision = decideGitHubProjectPlanningChange({
    delivery: { action: delivery.action },
    project,
    task,
    resolvedSprintId,
  });
  if (decision.kind === "ignored") {
    if (decision.reason === "already_aligned") {
      await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [task.id], observedIssue);
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "processed",
        statusReason: "already_aligned",
      });
      return { kind: "processed", reason: "corrected_in_github" };
    }
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "ignored",
      statusReason: decision.reason,
    });
    return { kind: "ignored", reason: decision.reason };
  }

  const actorValue = await store.resolveActor(delivery.senderId);
  if (!actorValue || decision.kind === "reconcile") {
    await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [task.id], observedIssue);
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "processed",
      statusReason: actorValue ? decision.kind === "reconcile" ? decision.reason : "corrected_in_github" : "actor_not_mapped",
    });
    return { kind: "processed", reason: "corrected_in_github" };
  }

  const applied = decision.kind === "request_review"
    ? await requestReview(supabase, task, actorValue)
    : await applyTaskUpdate(supabase, task, actorValue, decision.patch);
  await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [task.id], observedIssue);
  await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
    status: "processed",
    statusReason: applied ? "founderops_updated" : "change_not_authorized",
  });
  return applied
    ? { kind: "processed", reason: "founderops_updated" }
    : { kind: "processed", reason: "corrected_in_github" };
}

async function resolvePair(
  store: GitHubPlanningWebhookStore,
  delivery: ClaimedGitHubPlanningDelivery,
) {
  const [primary, related] = await Promise.all([
    store.resolveTask(delivery.repositoryFullName, delivery.issueNumber),
    store.resolveTask(delivery.relatedRepositoryFullName, delivery.relatedIssueNumber || 0),
  ]);
  if (primary.kind === "ambiguous" || related.kind === "ambiguous") return { kind: "ambiguous" as const };
  if (primary.kind === "missing" || related.kind === "missing") return { kind: "missing" as const };
  const [primaryTask, relatedTask] = await Promise.all([
    store.loadTask(primary.taskId),
    store.loadTask(related.taskId),
  ]);
  if (!primaryTask || !relatedTask) throw new Error("FounderOps relationship task disappeared after mapping.");
  return { kind: "found" as const, primaryTask, relatedTask };
}

function relationshipObservationMatchesDelivery(
  delivery: ClaimedGitHubPlanningDelivery,
  observation: RelationshipObservation,
) {
  if (
    !sameTimestamp(observation.primaryUpdatedAt, delivery.issueUpdatedAt)
    || !sameTimestamp(observation.relatedUpdatedAt, delivery.relatedIssueUpdatedAt)
  ) {
    return false;
  }
  if (delivery.eventName === "sub_issues" && observation.kind === "sub_issue") {
    const isDeliveredParent = Boolean(
      observation.parent
      && observation.parent.repositoryFullName.toLowerCase() === delivery.repositoryFullName.toLowerCase()
      && observation.parent.issueNumber === delivery.issueNumber
    );
    if (delivery.action === "parent_issue_added" || delivery.action === "sub_issue_added") {
      return isDeliveredParent;
    }
    if (delivery.action === "parent_issue_removed" || delivery.action === "sub_issue_removed") {
      return !isDeliveredParent;
    }
    return false;
  }
  if (delivery.eventName === "issue_dependencies" && observation.kind === "dependency") {
    if (delivery.action === "blocked_by_added" || delivery.action === "blocking_added") {
      return observation.exists;
    }
    if (delivery.action === "blocked_by_removed" || delivery.action === "blocking_removed") {
      return !observation.exists;
    }
  }
  return false;
}

async function processRelationshipDelivery({
  delivery,
  lockToken,
  store,
  supabase,
  loadRelationship,
}: {
  delivery: ClaimedGitHubPlanningDelivery;
  lockToken: string;
  store: GitHubPlanningWebhookStore;
  supabase: SupabaseClient;
  loadRelationship: RelationshipLoader;
}): Promise<GitHubPlanningWebhookResult> {
  if (delivery.eventName === "sub_issues") {
    const childMapping = await store.resolveTask(
      delivery.relatedRepositoryFullName,
      delivery.relatedIssueNumber || 0,
    );
    if (childMapping.kind === "ambiguous") {
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "failed",
        statusReason: "ambiguous_task_mapping",
        lastError: "More than one FounderOps task references the GitHub Sub-Issue.",
      });
      return { kind: "failed", reason: "ambiguous_task_mapping" };
    }
    if (childMapping.kind === "missing") {
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "ignored",
        statusReason: "task_not_found",
      });
      return { kind: "ignored", reason: "task_not_found" };
    }
    const child = await store.loadTask(childMapping.taskId);
    if (!child) throw new Error("FounderOps Sub-Issue disappeared after GitHub mapping.");
    const observation = await loadRelationship(delivery);
    if (observation.kind !== "sub_issue") {
      throw new Error("GitHub Sub-Issue observation has the wrong event type.");
    }
    if (!relationshipObservationMatchesDelivery(delivery, observation)) {
      await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [child.id]);
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "processed",
        statusReason: "superseded",
      });
      return { kind: "processed", reason: "corrected_in_github" };
    }

    let parent: GitHubPlanningTaskSnapshot | null = null;
    if (observation.parent) {
      const parentMapping = await store.resolveTask(
        observation.parent.repositoryFullName,
        observation.parent.issueNumber,
      );
      if (parentMapping.kind === "ambiguous") {
        await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
          status: "failed",
          statusReason: "ambiguous_task_mapping",
          lastError: "More than one FounderOps task references the current GitHub parent Issue.",
        });
        return { kind: "failed", reason: "ambiguous_task_mapping" };
      }
      if (parentMapping.kind === "found") {
        parent = await store.loadTask(parentMapping.taskId);
        if (!parent) throw new Error("FounderOps parent disappeared after GitHub mapping.");
      }
    }

    const actorValue = await store.resolveActor(delivery.senderId);
    const applied = actorValue && parent
      ? await applySubIssueRelationship(supabase, child, parent, actorValue)
      : false;
    await enqueueTasksAndDispatch(
      supabase,
      store,
      delivery,
      lockToken,
      parent ? [child.id, parent.id] : [child.id],
    );
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "processed",
      statusReason: applied ? "founderops_updated" : actorValue ? "change_not_authorized" : "actor_not_mapped",
    });
    return applied
      ? { kind: "processed", reason: "founderops_updated" }
      : { kind: "processed", reason: "corrected_in_github" };
  }

  const pair = await resolvePair(store, delivery);
  if (pair.kind === "ambiguous") {
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "failed",
      statusReason: "ambiguous_task_mapping",
      lastError: "More than one FounderOps task references a GitHub relationship Issue.",
    });
    return { kind: "failed", reason: "ambiguous_task_mapping" };
  }
  if (pair.kind === "missing") {
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "ignored",
      statusReason: "task_not_found",
    });
    return { kind: "ignored", reason: "task_not_found" };
  }

  const observation = await loadRelationship(delivery);
  if (observation.kind !== "dependency") {
    throw new Error("GitHub dependency observation has the wrong event type.");
  }
  const taskIds = [pair.primaryTask.id, pair.relatedTask.id];
  if (!relationshipObservationMatchesDelivery(delivery, observation)) {
    await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, taskIds);
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "processed",
      statusReason: "superseded",
    });
    return { kind: "processed", reason: "corrected_in_github" };
  }
  const actorValue = await store.resolveActor(delivery.senderId);
  if (!actorValue) {
    await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, taskIds);
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "processed",
      statusReason: "actor_not_mapped",
    });
    return { kind: "processed", reason: "corrected_in_github" };
  }

  const relationship = await store.findBlockedByRelationship(pair.primaryTask.id, pair.relatedTask.id);
  const applied = await applyDependencyRelationship(
    supabase,
    pair.primaryTask,
    pair.relatedTask,
    relationship,
    actorValue,
    observation.exists ? "add" : "remove",
  );

  await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, taskIds);
  await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
    status: "processed",
    statusReason: applied ? "founderops_updated" : "change_not_authorized",
  });
  return applied
    ? { kind: "processed", reason: "founderops_updated" }
    : { kind: "processed", reason: "corrected_in_github" };
}

export async function processGitHubPlanningWebhookDelivery({
  deliveryId,
  supabase,
  store = createSupabaseGitHubPlanningWebhookStore(supabase),
  loadIssue = loadCurrentGitHubIssue,
  loadIssueField,
  loadProject,
  loadRelationship = loadCurrentGitHubRelationship,
}: {
  deliveryId: string;
  supabase: SupabaseClient;
  store?: GitHubPlanningWebhookStore;
  loadIssue?: IssueLoader;
  loadIssueField?: IssueFieldLoader;
  loadProject?: ProjectLoader;
  loadRelationship?: RelationshipLoader;
}): Promise<GitHubPlanningWebhookResult> {
  const lockToken = randomUUID();
  const delivery = await store.claim(deliveryId, lockToken);
  if (!delivery) return { kind: "skipped" };

  try {
    if (delivery.senderType.toLowerCase() === "bot") {
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "ignored",
        statusReason: "app_projection",
      });
      return { kind: "ignored", reason: "app_projection" };
    }

    if (delivery.eventName === "sub_issues" || delivery.eventName === "issue_dependencies") {
      return processRelationshipDelivery({ delivery, lockToken, store, supabase, loadRelationship });
    }
    if (delivery.eventName === "projects_v2_item") {
      const projectLoader = loadProject || (async (projectDelivery: ClaimedGitHubPlanningDelivery) => (
        loadGitHubPlanningProjectObservation({
          supabase,
          projectNodeId: projectDelivery.projectNodeId,
          projectItemNodeId: projectDelivery.projectItemNodeId,
          contentNodeId: projectDelivery.projectContentNodeId,
          fieldNodeId: projectDelivery.projectFieldNodeId || null,
          token: await getGitHubAppInstallationToken(),
        })
      ));
      return processProjectDelivery({ delivery, lockToken, store, supabase, loadProject: projectLoader });
    }
    if (delivery.eventName !== "issues") {
      throw new Error(`GitHub planning event ${delivery.eventName} has no processor adapter.`);
    }
    const mapping = await store.resolveTask(delivery.repositoryFullName, delivery.issueNumber);
    if (mapping.kind === "ambiguous") {
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "failed",
        statusReason: "ambiguous_task_mapping",
        lastError: "More than one FounderOps task references the GitHub Issue.",
      });
      return { kind: "failed", reason: "ambiguous_task_mapping" };
    }
    if (mapping.kind === "missing") {
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "ignored",
        statusReason: "task_not_found",
      });
      return { kind: "ignored", reason: "task_not_found" };
    }

    const task = await store.loadTask(mapping.taskId);
    if (!task) throw new Error("FounderOps task disappeared after GitHub mapping.");
    const [issue, actorValue, targetProfile] = await Promise.all([
      loadIssue(delivery),
      store.resolveActor(delivery.senderId),
      store.resolveActor(delivery.targetUserId),
    ]);
    if (!sameTimestamp(issue.updatedAt, delivery.issueUpdatedAt)) {
      await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [task.id]);
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "processed",
        statusReason: "superseded",
      });
      return { kind: "processed", reason: "corrected_in_github" };
    }
    const policyDelivery: GitHubPlanningIssueDelivery = {
      action: delivery.action,
      changedFields: delivery.changedFields,
      targetUserId: delivery.targetUserId,
    };
    const fieldName = changedIssueFieldName(delivery);
    const decision = (delivery.action === "field_added" || delivery.action === "field_removed")
      ? isFounderOpsManagedGitHubIssueField(fieldName)
        ? decideGitHubIssueFieldPlanningChange({
            ...(await (loadIssueField || (async (fieldDelivery, managedFieldName) => (
              loadGitHubPlanningIssueFieldObservation({
                supabase,
                repositoryFullName: fieldDelivery.repositoryFullName,
                issueNumber: fieldDelivery.issueNumber,
                issueNodeId: fieldDelivery.issueNodeId,
                fieldName: managedFieldName,
                token: await getGitHubAppInstallationToken(),
              })
            )))(delivery, fieldName)),
            task,
          })
        : { kind: "ignored" as const, reason: "unowned_change" as const }
      : decideGitHubIssuePlanningChange({
          delivery: policyDelivery,
          issue,
          task,
          targetProfileId: targetProfile?.profileId,
        });

    if (decision.kind === "ignored") {
      if (decision.reason === "already_aligned") {
        await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [task.id]);
        await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
          status: "processed",
          statusReason: "already_aligned",
        });
        return { kind: "processed", reason: "corrected_in_github" };
      }
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "ignored",
        statusReason: decision.reason,
      });
      return { kind: "ignored", reason: decision.reason };
    }

    if (!actorValue || decision.kind === "reconcile") {
      await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [task.id]);
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "processed",
        statusReason: actorValue ? decision.kind === "reconcile" ? decision.reason : "corrected_in_github" : "actor_not_mapped",
      });
      return { kind: "processed", reason: "corrected_in_github" };
    }

    const applied = decision.kind === "request_review"
      ? await requestReview(supabase, task, actorValue)
      : await applyTaskUpdate(supabase, task, actorValue, decision.patch);
    if (!applied) {
      await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [task.id]);
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "processed",
        statusReason: "change_not_authorized",
      });
      return { kind: "processed", reason: "corrected_in_github" };
    }

    await enqueueTasksAndDispatch(supabase, store, delivery, lockToken, [task.id]);
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "processed",
      statusReason: "founderops_updated",
    });
    return { kind: "processed", reason: "founderops_updated" };
  } catch (error) {
    const projectionError = error instanceof ProjectionDeliveryError ? error : null;
    const terminal = projectionError?.terminal ?? delivery.attempts >= 5;
    const message = error instanceof Error ? error.message : "GitHub planning delivery failed.";
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: terminal ? "failed" : "retry_scheduled",
      statusReason: "processing_error",
      lastError: message,
      availableAt: terminal ? undefined : projectionError?.availableAt || retryAt(delivery.attempts),
    });
    return { kind: terminal ? "failed" : "retry_scheduled", reason: "processing_error" };
  }
}
