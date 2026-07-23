import type { AuditEntry, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation } from "./types";
import type { DbAuditEntry, DbTaskAuditActivity, DbTaskBlocker, DbTaskComment, DbTaskExternalComment, DbTaskFocusItem, DbTaskRelation } from "./planning-data-row-types";

export function mapAuditEntry(row: DbAuditEntry): AuditEntry {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actorProfileId: row.actor_profile_id || "",
    createdAt: row.created_at,
    beforeData: row.before_data,
    afterData: row.after_data,
  };
}

export function mapTaskComment(row: DbTaskComment): TaskComment {
  const delivery = Array.isArray(row.task_comment_github_deliveries)
    ? row.task_comment_github_deliveries[0]
    : row.task_comment_github_deliveries;
  return {
    id: row.id,
    taskId: row.task_id,
    profileId: row.profile_id || "",
    comment: row.comment,
    githubDeliveryStatus: delivery?.status || "pending",
    githubCommentUrl: delivery?.github_comment_url || "",
    createdAt: row.created_at,
  };
}

export function mapTaskExternalComment(row: DbTaskExternalComment): TaskExternalComment {
  return {
    id: row.id,
    taskId: row.task_id,
    source: row.source,
    externalId: row.external_id,
    authorLogin: row.author_login,
    authorAvatarUrl: row.author_avatar_url || "",
    body: row.body,
    htmlUrl: row.html_url || "",
    createdAt: row.created_at,
    importedAt: row.imported_at,
  };
}

export function mapTaskBlocker(row: DbTaskBlocker): TaskBlocker {
  return {
    id: row.id,
    taskId: row.task_id,
    profileId: row.profile_id || "",
    reason: row.reason,
    impact: row.impact || "",
    needsHelpFrom: row.needs_help_from || "",
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || "",
  };
}

export function mapTaskRelation(row: DbTaskRelation): TaskRelation {
  return {
    id: row.id,
    taskId: row.task_id,
    relatedTaskId: row.related_task_id,
    relationType: row.relation_type,
    note: row.note || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
  };
}

export function mapTaskAuditActivity(row: DbTaskAuditActivity): TaskActivity {
  return {
    id: row.id,
    taskId: row.task_id,
    action: row.action,
    actorProfileId: row.actor_profile_id || "",
    message: row.message || "",
    beforeData: null,
    afterData: row.payload,
    createdAt: row.created_at,
  };
}

export function mapTaskFocusItem(row: DbTaskFocusItem): TaskFocusItem {
  return {
    id: row.id,
    profileId: row.profile_id || "",
    taskId: row.task_id,
    focusDate: row.focus_date,
    position: row.position,
    nextStep: row.next_step || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
