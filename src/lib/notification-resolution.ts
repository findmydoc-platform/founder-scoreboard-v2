import type { SupabaseClient } from "@supabase/supabase-js";
import { notificationDefinition } from "./notification-catalog";
import { isOperationalLeadRole } from "./platform";
import { normalizeStatus } from "./status";
import type { FounderEvent, NotificationEvent, PlanningData, PlatformRole, Sprint, Task, TaskBlocker } from "./types";

type ResolutionTask = Pick<Task, "id" | "status" | "assignee" | "owner" | "reviewOwnerProfileId" | "reviewStatus" | "scoreFinal" | "taskType" | "endDate" | "deadline">;
type ResolutionSprint = Pick<Sprint, "id" | "status" | "scoreLocked" | "reviewDueAt">;
type ResolutionEvent = Pick<FounderEvent, "id" | "status" | "startsAt" | "audienceMode" | "participantProfileIds" | "reminderDaysBefore">;

export type NotificationResolutionContext = {
  tasks?: Map<string, ResolutionTask>;
  blockers?: Map<string, TaskBlocker[]>;
  sprints?: Map<string, ResolutionSprint>;
  events?: Map<string, ResolutionEvent>;
  meetings?: Set<string>;
  profileRoles?: Map<string, PlatformRole>;
};

export type NotificationResolution = {
  reason: string;
} | null | undefined;

const taskInformationalTypes = new Set([
  "task.comment",
  "task.mention",
  "task.review_completed",
  "task.review_reopened",
  "sprint.task_carried_over",
]);

function dateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function isDueTodayOrOverdue(value: string, now: Date) {
  return Boolean(value) && value.slice(0, 10) <= dateKey(now);
}

function isTaskDone(task: ResolutionTask) {
  return normalizeStatus(task.status) === "Erledigt" || task.scoreFinal;
}

function taskFor(event: NotificationEvent, context: NotificationResolutionContext) {
  if (!context.tasks) return undefined;
  return context.tasks.get(event.entityId) || null;
}

export function notificationResolution(
  event: NotificationEvent,
  context: NotificationResolutionContext,
  now = new Date(),
): NotificationResolution {
  if (event.status !== "pending") return null;
  const definition = notificationDefinition(event.type);
  if (!definition) return undefined;

  if (taskInformationalTypes.has(event.type)) {
    const task = taskFor(event, context);
    if (task === undefined) return undefined;
    return task ? null : { reason: "source_deleted" };
  }

  if (event.type === "meeting.attendance_updated") {
    if (!context.meetings) return undefined;
    return context.meetings.has(event.entityId) ? null : { reason: "source_deleted" };
  }

  if (event.type === "task.review_requested") {
    const task = taskFor(event, context);
    if (task === undefined) return undefined;
    if (!task) return { reason: "source_deleted" };
    if (task.reviewStatus !== "requested") return { reason: "review_completed" };
    if (task.reviewOwnerProfileId) {
      return event.recipientProfileId === task.reviewOwnerProfileId ? null : { reason: "recipient_changed" };
    }
    if (!event.recipientProfileId) return null;
    if (!context.profileRoles) return undefined;
    const role = context.profileRoles.get(event.recipientProfileId);
    return role && isOperationalLeadRole(role) ? null : { reason: "recipient_changed" };
  }

  if (event.type === "task.review_rework") {
    const task = taskFor(event, context);
    if (task === undefined) return undefined;
    if (!task) return { reason: "source_deleted" };
    if (task.reviewStatus !== "changes_requested" && normalizeStatus(task.status) !== "Nacharbeit") {
      return { reason: "rework_completed" };
    }
    const assignee = task.assignee || task.owner;
    return assignee && assignee === event.recipientProfileId ? null : { reason: "recipient_changed" };
  }

  if (event.type === "task.blocker_reported") {
    const task = taskFor(event, context);
    if (task === undefined || !context.blockers) return undefined;
    if (!task) return { reason: "source_deleted" };
    if (!(context.blockers.get(event.entityId) || []).some((blocker) => blocker.status === "open")) {
      return { reason: "blocker_resolved" };
    }
    if (!event.recipientProfileId) return null;
    if (!context.profileRoles) return undefined;
    const role = context.profileRoles.get(event.recipientProfileId);
    return role && isOperationalLeadRole(role) ? null : { reason: "recipient_changed" };
  }

  if (event.type === "task.deadline_overdue") {
    const task = taskFor(event, context);
    if (task === undefined) return undefined;
    if (!task) return { reason: "source_deleted" };
    if (isTaskDone(task) || task.taskType !== "deliverable") return { reason: "deadline_completed" };
    const assignee = task.assignee || task.owner;
    if (!assignee || assignee !== event.recipientProfileId) return { reason: "recipient_changed" };
    return isDueTodayOrOverdue(task.endDate || task.deadline, now) ? null : { reason: "deadline_changed" };
  }

  if (event.type === "task.proposed") {
    const task = taskFor(event, context);
    if (task === undefined) return undefined;
    if (!task) return { reason: "source_deleted" };
    if (task.taskType !== "proposal" && normalizeStatus(task.status) !== "Vorschlag") {
      return { reason: "proposal_closed" };
    }
    if (!event.recipientProfileId) return null;
    if (!context.profileRoles) return undefined;
    const role = context.profileRoles.get(event.recipientProfileId);
    return role && isOperationalLeadRole(role) ? null : { reason: "recipient_changed" };
  }

  if (event.type === "sprint.review_due") {
    if (!context.sprints) return undefined;
    const sprint = context.sprints.get(event.entityId);
    if (!sprint) return { reason: "source_deleted" };
    if (sprint.scoreLocked || sprint.status === "closed") return { reason: "sprint_closed" };
    return isDueTodayOrOverdue(sprint.reviewDueAt, now) ? null : { reason: "sprint_review_not_due" };
  }

  if (event.type === "event.upcoming") {
    if (!context.events) return undefined;
    const founderEvent = context.events.get(event.entityId);
    if (!founderEvent) return { reason: "source_deleted" };
    if (founderEvent.status !== "planned") return { reason: "event_closed" };
    const startsAt = new Date(founderEvent.startsAt);
    if (Number.isNaN(startsAt.getTime())) return undefined;
    const windowStartsAt = startsAt.getTime() - Math.max(0, founderEvent.reminderDaysBefore) * 86_400_000;
    if (now.getTime() < windowStartsAt || now.getTime() > startsAt.getTime()) {
      return { reason: "event_outside_reminder_window" };
    }
    if (!event.recipientProfileId) return null;
    if (!context.profileRoles) return undefined;
    if (!context.profileRoles.has(event.recipientProfileId)) return { reason: "recipient_changed" };
    if (founderEvent.audienceMode === "selected" && !founderEvent.participantProfileIds.includes(event.recipientProfileId)) {
      return { reason: "recipient_changed" };
    }
    return null;
  }

  return definition.lifecycle === "informational" ? null : undefined;
}

export function resolveNotificationEvents(data: PlanningData, now = new Date()) {
  const context: NotificationResolutionContext = {
    tasks: new Map(data.tasks.map((task) => [task.id, task])),
    blockers: new Map(data.tasks.map((task) => [task.id, data.taskBlockers.filter((blocker) => blocker.taskId === task.id)])),
    sprints: new Map(data.sprints.map((sprint) => [sprint.id, sprint])),
    events: new Map(data.events.map((event) => [String(event.id), event])),
    meetings: new Set(data.meetings.map((meeting) => String(meeting.id))),
    profileRoles: new Map(data.profiles.map((profile) => [profile.id, profile.platformRole])),
  };
  const resolvedEventIds: number[] = [];
  const resolvedAt = now.toISOString();
  const notificationEvents = data.notificationEvents.map((event) => {
    const resolution = notificationResolution(event, context, now);
    if (!resolution) return event;
    resolvedEventIds.push(event.id);
    return { ...event, status: "resolved" as const, resolvedAt, resolutionReason: resolution.reason };
  });
  return { data: resolvedEventIds.length ? { ...data, notificationEvents } : data, resolvedEventIds };
}

type ReconciliationOptions = {
  currentProfileId?: string | null;
  platformRole?: PlatformRole | null;
  pageSize?: number;
  now?: Date;
};

type NotificationRow = {
  id: number;
  type: string;
  actor_profile_id: string | null;
  recipient_profile_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string | null;
  status: NotificationEvent["status"];
  seen_at: string | null;
  dismissed_at: string | null;
  resolved_at: string | null;
  resolution_reason: string | null;
  created_at: string;
};

function mapRow(row: NotificationRow): NotificationEvent {
  return {
    id: row.id,
    type: row.type,
    actorProfileId: row.actor_profile_id || "",
    recipientProfileId: row.recipient_profile_id || "",
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body || "",
    status: row.status,
    seenAt: row.seen_at || "",
    dismissedAt: row.dismissed_at || "",
    resolvedAt: row.resolved_at || "",
    resolutionReason: row.resolution_reason || "",
    createdAt: row.created_at,
  };
}

async function loadResolutionContext(supabase: SupabaseClient, events: NotificationEvent[]): Promise<NotificationResolutionContext> {
  const taskIds = [...new Set(events.filter((event) => event.entityType === "task").map((event) => event.entityId))];
  const sprintIds = [...new Set(events.filter((event) => event.entityType === "sprint").map((event) => event.entityId))];
  const founderEventIds = [...new Set(events.filter((event) => event.entityType === "founder_event").map((event) => Number(event.entityId)).filter(Number.isInteger))];
  const meetingIds = [...new Set(events.filter((event) => event.entityType === "meeting").map((event) => Number(event.entityId)).filter(Number.isInteger))];
  const profileIds = [...new Set(events.map((event) => event.recipientProfileId).filter(Boolean))];

  const [tasks, blockers, sprints, founderEvents, meetings, profiles] = await Promise.all([
    taskIds.length ? supabase.from("tasks").select("id,status,assignee,owner,review_owner_profile_id,review_status,score_final,task_type,end_date,deadline").in("id", taskIds) : Promise.resolve({ data: [], error: null }),
    taskIds.length ? supabase.from("task_blockers").select("id,task_id,profile_id,reason,impact,needs_help_from,status,created_at,resolved_at").in("task_id", taskIds) : Promise.resolve({ data: [], error: null }),
    sprintIds.length ? supabase.from("sprints").select("id,status,score_locked,review_due_at").in("id", sprintIds) : Promise.resolve({ data: [], error: null }),
    founderEventIds.length ? supabase.from("founder_events").select("id,status,starts_at,audience_mode,participant_profile_ids,reminder_days_before").in("id", founderEventIds) : Promise.resolve({ data: [], error: null }),
    meetingIds.length ? supabase.from("meetings").select("id").in("id", meetingIds) : Promise.resolve({ data: [], error: null }),
    profileIds.length ? supabase.from("profiles").select("id,platform_role").in("id", profileIds) : Promise.resolve({ data: [], error: null }),
  ]);

  const taskRows = tasks.error ? undefined : new Map((tasks.data || []).map((row) => [row.id, {
    id: row.id,
    status: row.status,
    assignee: row.assignee || "",
    owner: row.owner || "",
    reviewOwnerProfileId: row.review_owner_profile_id || "",
    reviewStatus: row.review_status,
    scoreFinal: Boolean(row.score_final),
    taskType: row.task_type,
    endDate: row.end_date || "",
    deadline: row.deadline || "",
  }]));
  const blockerMap = blockers.error ? undefined : new Map<string, TaskBlocker[]>();
  if (blockerMap) {
    for (const row of blockers.data || []) {
      const current = blockerMap.get(row.task_id) || [];
      current.push({ id: row.id, taskId: row.task_id, profileId: row.profile_id || "", reason: row.reason, impact: row.impact || "", needsHelpFrom: row.needs_help_from || "", status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at || "" });
      blockerMap.set(row.task_id, current);
    }
  }

  return {
    tasks: taskRows,
    blockers: blockerMap,
    sprints: sprints.error ? undefined : new Map((sprints.data || []).map((row) => [row.id, { id: row.id, status: row.status, scoreLocked: Boolean(row.score_locked), reviewDueAt: row.review_due_at || "" }])),
    events: founderEvents.error ? undefined : new Map((founderEvents.data || []).map((row) => [String(row.id), { id: row.id, status: row.status, startsAt: row.starts_at, audienceMode: row.audience_mode, participantProfileIds: row.participant_profile_ids || [], reminderDaysBefore: Number(row.reminder_days_before || 0) }])),
    meetings: meetings.error ? undefined : new Set((meetings.data || []).map((row) => String(row.id))),
    profileRoles: profiles.error ? undefined : new Map((profiles.data || []).map((row) => [row.id, row.platform_role as PlatformRole])),
  };
}

export async function reconcileNotificationEvents(supabase: SupabaseClient, options: ReconciliationOptions = {}) {
  const pageSize = Math.min(Math.max(options.pageSize || 200, 1), 500);
  const now = options.now || new Date();
  let cursor = 0;
  let checked = 0;
  let resolved = 0;

  while (true) {
    let query = supabase
      .from("notification_events")
      .select("id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,status,seen_at,dismissed_at,resolved_at,resolution_reason,created_at")
      .eq("status", "pending")
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (options.currentProfileId) {
      query = options.platformRole && isOperationalLeadRole(options.platformRole)
        ? query.or(`recipient_profile_id.eq.${options.currentProfileId},recipient_profile_id.is.null`)
        : query.eq("recipient_profile_id", options.currentProfileId);
    }

    const result = await query;
    if (result.error) return { ok: false, checked, resolved, error: result.error.message };
    const rows = (result.data || []) as NotificationRow[];
    if (!rows.length) return { ok: true, checked, resolved, error: "" };
    cursor = rows[rows.length - 1].id;
    const events = rows.map(mapRow);
    checked += events.length;
    const context = await loadResolutionContext(supabase, events);
    const byReason = new Map<string, number[]>();
    for (const event of events) {
      const resolution = notificationResolution(event, context, now);
      if (!resolution) continue;
      byReason.set(resolution.reason, [...(byReason.get(resolution.reason) || []), event.id]);
    }

    for (const [reason, ids] of byReason) {
      const update = await supabase
        .from("notification_events")
        .update({ status: "resolved", resolved_at: now.toISOString(), resolution_reason: reason })
        .in("id", ids)
        .eq("status", "pending");
      if (update.error) return { ok: false, checked, resolved, error: update.error.message };
      resolved += ids.length;
    }
    if (rows.length < pageSize) return { ok: true, checked, resolved, error: "" };
  }
}

export async function persistResolvedNotificationEvents(supabase: SupabaseClient, data: PlanningData) {
  const result = await reconcileNotificationEvents(supabase);
  return result.ok ? resolveNotificationEvents(data).data : data;
}
