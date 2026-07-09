import type { SupabaseClient } from "@supabase/supabase-js";
import { mapFounderEvent, mapTaskBlocker } from "./planning-data-mappers";
import type { DbFounderEvent, DbTaskBlocker } from "./planning-data-row-types";
import { normalizeStatus } from "./status";
import type { NotificationEvent, PlanningData, Task } from "./types";

export const autoResolvableNotificationTypes = [
  "task.review_requested",
  "task.review_rework",
  "task.blocker_reported",
  "task.deadline_overdue",
  "task.proposed",
  "sprint.review_due",
  "event.upcoming",
] as const;

export const informationalNotificationTypes = [
  "task.comment",
  "task.mention",
  "task.review_completed",
  "sprint.task_carried_over",
  "meeting.attendance_updated",
] as const;

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

function isTaskDone(task: Task) {
  return normalizeStatus(task.status) === "Erledigt" || task.scoreFinal;
}

function resolveTaskReviewRequested(event: NotificationEvent, data: PlanningData) {
  const task = data.tasks.find((item) => item.id === event.entityId);
  if (!task) return true;
  return task.reviewStatus !== "requested";
}

function resolveTaskReviewRework(event: NotificationEvent, data: PlanningData) {
  const task = data.tasks.find((item) => item.id === event.entityId);
  if (!task) return true;
  return task.reviewStatus !== "changes_requested" && normalizeStatus(task.status) !== "Nacharbeit";
}

function resolveTaskBlocker(event: NotificationEvent, data: PlanningData) {
  const task = data.tasks.find((item) => item.id === event.entityId);
  if (!task) return true;
  return !data.taskBlockers.some((blocker) => blocker.taskId === event.entityId && blocker.status === "open");
}

function resolveTaskDeadline(event: NotificationEvent, data: PlanningData, now: Date) {
  const task = data.tasks.find((item) => item.id === event.entityId);
  if (!task || isTaskDone(task) || task.taskType !== "deliverable") return true;
  const dueDate = task.endDate || task.deadline;
  return !isDueTodayOrOverdue(dueDate, now);
}

function resolveTaskProposal(event: NotificationEvent, data: PlanningData) {
  const task = data.tasks.find((item) => item.id === event.entityId);
  if (!task) return true;
  return task.taskType !== "proposal" && normalizeStatus(task.status) !== "Vorschlag";
}

function resolveSprintReview(event: NotificationEvent, data: PlanningData, now: Date) {
  const sprint = data.sprints.find((item) => item.id === event.entityId);
  if (!sprint || sprint.scoreLocked || sprint.status === "closed") return true;
  return !isDueTodayOrOverdue(sprint.reviewDueAt, now);
}

function resolveFounderEvent(event: NotificationEvent, data: PlanningData, now: Date) {
  const founderEvent = data.events.find((item) => String(item.id) === event.entityId);
  if (!founderEvent || founderEvent.status !== "planned") return true;
  const startsAt = new Date(founderEvent.startsAt);
  return Number.isNaN(startsAt.getTime()) || startsAt.getTime() < now.getTime();
}

export function isNotificationSourceResolved(event: NotificationEvent, data: PlanningData, now = new Date()) {
  if (event.status !== "pending") return false;

  switch (event.type) {
    case "task.review_requested":
      return resolveTaskReviewRequested(event, data);
    case "task.review_rework":
      return resolveTaskReviewRework(event, data);
    case "task.blocker_reported":
      return resolveTaskBlocker(event, data);
    case "task.deadline_overdue":
      return resolveTaskDeadline(event, data, now);
    case "task.proposed":
      return resolveTaskProposal(event, data);
    case "sprint.review_due":
      return resolveSprintReview(event, data, now);
    case "event.upcoming":
      return resolveFounderEvent(event, data, now);
    default:
      return false;
  }
}

export function resolveNotificationEvents(data: PlanningData, now = new Date()) {
  const resolvedEventIds: number[] = [];
  const notificationEvents = data.notificationEvents.map((event) => {
    if (!isNotificationSourceResolved(event, data, now)) return event;
    resolvedEventIds.push(event.id);
    return { ...event, status: "resolved" as const };
  });

  return {
    data: resolvedEventIds.length ? { ...data, notificationEvents } : data,
    resolvedEventIds,
  };
}

async function loadNotificationResolutionSourceData(supabase: SupabaseClient, data: PlanningData) {
  const blockerTaskIds = Array.from(new Set(
    data.notificationEvents
      .filter((event) => event.status === "pending" && event.type === "task.blocker_reported")
      .map((event) => event.entityId)
      .filter(Boolean),
  ));
  const founderEventIds = Array.from(new Set(
    data.notificationEvents
      .filter((event) => event.status === "pending" && event.type === "event.upcoming")
      .map((event) => Number(event.entityId))
      .filter((id) => Number.isInteger(id) && id > 0),
  ));

  const [blockerResult, eventResult] = await Promise.all([
    blockerTaskIds.length
      ? supabase
        .from("task_blockers")
        .select("id,task_id,profile_id,reason,impact,needs_help_from,status,created_at,resolved_at")
        .in("task_id", blockerTaskIds)
      : Promise.resolve({ data: [] as DbTaskBlocker[], error: null }),
    founderEventIds.length
      ? supabase
        .from("founder_events")
        .select("id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status,created_by,created_at,updated_at")
        .in("id", founderEventIds)
      : Promise.resolve({ data: [] as DbFounderEvent[], error: null }),
  ]);

  if (blockerResult.error || eventResult.error) return null;

  return {
    ...data,
    taskBlockers: blockerTaskIds.length ? (blockerResult.data as DbTaskBlocker[]).map(mapTaskBlocker) : data.taskBlockers,
    events: founderEventIds.length ? (eventResult.data as DbFounderEvent[]).map(mapFounderEvent) : data.events,
  };
}

export async function persistResolvedNotificationEvents(supabase: SupabaseClient, data: PlanningData) {
  const resolutionData = await loadNotificationResolutionSourceData(supabase, data);
  if (!resolutionData) return data;
  const { data: resolvedData, resolvedEventIds } = resolveNotificationEvents(resolutionData);
  if (!resolvedEventIds.length) return data;

  const { error } = await supabase
    .from("notification_events")
    .update({ status: "resolved" })
    .in("id", resolvedEventIds)
    .eq("status", "pending");

  return error ? data : { ...data, notificationEvents: resolvedData.notificationEvents };
}
