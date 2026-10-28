import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadAllSupabaseRows } from "@/features/planning-items/model/supabase-pagination";
import {
  taskDetailReadLimits,
  type TaskDetailLoadResult,
  type TaskDetailModel,
  type TaskDetailReadModel,
  type TaskDetailUnavailableArea,
} from "@/features/tasks/model/task-detail-read-model";
import {
  mapTaskAuditActivity,
  mapTaskBlocker,
  mapTaskComment,
  mapTaskExternalComment,
  mapTaskRelation,
  mapTaskReview,
} from "@/lib/planning-row-mappers";
import {
  taskRowSelect,
  type DbPlanningItemRaciAssignment,
  type DbPlanningItemStrategy,
  type DbProfile,
  type DbSprint,
  type DbTask,
  type DbTaskAuditActivity,
  type DbTaskBlocker,
  type DbTaskComment,
  type DbTaskExternalComment,
  type DbTaskLink,
  type DbTaskRelation,
  type DbTaskReview,
} from "@/lib/planning-row-types";
import { mapProfile } from "@/lib/planning-profile-mappers";
import { mapSprint } from "@/lib/planning-sprint-mappers";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS } from "@/lib/sprint-review-window";
import type { Profile, Project, Task } from "@/lib/types";

const projectId = "findmydoc-founder-execution";
const profileSelect = "id,name,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color";
const projectSelect = "id,name,range_label,review_objection_window_hours";
const sprintSelect = "id,name,status,start_date,end_date,review_due_at,score_locked,updated_at";
const relationSelect = "id,task_id,related_task_id,relation_type,note,created_by,created_at";

type ProjectRow = {
  id: string;
  name: string;
  range_label: string | null;
  review_objection_window_hours: number | null;
};

function project(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    range: row.range_label || "",
    reviewObjectionWindowHours: Number(row.review_objection_window_hours || DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS),
    githubProjectOwner: "",
    githubProjectNumber: 0,
  };
}

function uniqueRows<Row extends { id: string }>(rows: readonly Row[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()];
}

function uniqueRelations(rows: readonly DbTaskRelation[]) {
  return [...new Map(rows.map((row) => [row.id, row])).values()]
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id - left.id);
}

async function loadAncestors(supabase: SupabaseClient, firstParentId: string | null) {
  const rows: DbTask[] = [];
  let parentId = firstParentId || "";
  for (let depth = 0; parentId && depth < taskDetailReadLimits.ancestorDepth; depth += 1) {
    const result = await supabase.from(ACTIVE_TASKS_TABLE).select(taskRowSelect).eq("id", parentId).maybeSingle<DbTask>();
    if (result.error) return { rows: [] as DbTask[], error: true };
    if (!result.data) break;
    rows.push(result.data);
    parentId = result.data.parent_task_id || "";
  }
  return { rows: rows.reverse(), error: false };
}

async function loadSupportingRows(supabase: SupabaseClient, itemIds: readonly string[]) {
  const result = { links: [] as DbTaskLink[], strategies: [] as DbPlanningItemStrategy[], raci: [] as DbPlanningItemRaciAssignment[], error: false };
  try {
    for (let from = 0; from < itemIds.length; from += taskDetailReadLimits.children) {
      const ids = itemIds.slice(from, from + taskDetailReadLimits.children);
      const [links, strategies, raci] = await Promise.all([
        loadAllSupabaseRows<DbTaskLink>((start, end) => supabase.from("task_links").select("id,task_id,type,label,url,position,metadata").in("task_id", ids).order("position").order("id").range(start, end)),
        loadAllSupabaseRows<DbPlanningItemStrategy>((start, end) => supabase.from("planning_item_strategy").select("task_id,goal,success_criteria,scope_constraints").in("task_id", ids).order("task_id").range(start, end)),
        loadAllSupabaseRows<DbPlanningItemRaciAssignment>((start, end) => supabase.from("planning_item_raci_assignments").select("task_id,profile_id,role,sort_order").in("task_id", ids).order("task_id").order("sort_order").order("profile_id").range(start, end)),
      ]);
      result.links.push(...links);
      result.strategies.push(...strategies);
      result.raci.push(...raci);
    }
    return result;
  } catch {
    return { ...result, error: true };
  }
}

async function loadDirectChildren(supabase: SupabaseClient, parentId: string) {
  try {
    const data = await loadAllSupabaseRows<DbTask>((from, to) => supabase.from(ACTIVE_TASKS_TABLE)
      .select(taskRowSelect).eq("parent_task_id", parentId).order("sort_order").order("id").range(from, to).returns<DbTask[]>(), taskDetailReadLimits.children);
    return { data, error: false };
  } catch {
    return { data: [] as DbTask[], error: true };
  }
}

function mapTasks(rows: readonly DbTask[], people: Profile[], supporting: Awaited<ReturnType<typeof loadSupportingRows>>) {
  const links = new Map<string, DbTaskLink[]>();
  for (const link of supporting.links) links.set(link.task_id, [...(links.get(link.task_id) || []), link]);
  const strategies = new Map(supporting.strategies.map((row) => [row.task_id, row]));
  const raci = new Map<string, DbPlanningItemRaciAssignment[]>();
  for (const assignment of supporting.raci) raci.set(assignment.task_id, [...(raci.get(assignment.task_id) || []), assignment]);
  const mapped = rows.map((row) => mapTaskRow(row, people, {
    taskLinks: links.get(row.id) || [],
    strategy: strategies.get(row.id),
    raciAssignments: raci.get(row.id) || [],
  }));
  const approvalById = new Map(mapped.map((task) => [task.id, task.approvalStatus]));
  return mapped.map((task) => task.parentTaskId
    ? { ...task, parentApprovalStatus: approvalById.get(task.parentTaskId) || null }
    : task);
}

function byIds(tasks: readonly Task[]) {
  return new Map(tasks.map((task) => [task.id, task]));
}

export function createSupabaseTaskDetailReadModel(supabase: SupabaseClient): TaskDetailReadModel {
  return {
    async load({ itemId }, context): Promise<TaskDetailLoadResult> {
      if (!context.authorized) return { status: "forbidden" };
      const normalizedItemId = itemId.trim();
      if (!normalizedItemId) return { status: "notFound", people: [] };

      const [targetResult, profileResult, projectResult, sprintResult] = await Promise.all([
        supabase.from(ACTIVE_TASKS_TABLE).select(taskRowSelect).eq("id", normalizedItemId).maybeSingle<DbTask>(),
        supabase.from("profiles").select(profileSelect).order("name"),
        supabase.from("projects").select(projectSelect).eq("id", projectId).single<ProjectRow>(),
        supabase.from("sprints").select(sprintSelect).order("start_date"),
      ]);
      if (targetResult.error || profileResult.error || projectResult.error || sprintResult.error || !projectResult.data) {
        return { status: "unavailable" };
      }
      const people = ((profileResult.data || []) as DbProfile[]).map(mapProfile);
      if (!targetResult.data) return { status: "notFound", people };

      const target = targetResult.data;
      const [ancestorsResult, childrenResult, outgoingResult, incomingResult] = await Promise.all([
        loadAncestors(supabase, target.parent_task_id),
        target.task_type === "sub_issue"
          ? Promise.resolve({ data: [] as DbTask[], error: null })
          : loadDirectChildren(supabase, normalizedItemId),
        supabase.from("task_relationship_edges").select(relationSelect).eq("task_id", normalizedItemId).order("created_at", { ascending: false }).limit(taskDetailReadLimits.relationships),
        supabase.from("task_relationship_edges").select(relationSelect).eq("related_task_id", normalizedItemId).order("created_at", { ascending: false }).limit(taskDetailReadLimits.relationships),
      ]);
      if (ancestorsResult.error || childrenResult.error) return { status: "unavailable" };

      const unavailable: TaskDetailUnavailableArea[] = [];
      const relationshipsUnavailable = Boolean(outgoingResult.error || incomingResult.error);
      if (relationshipsUnavailable) unavailable.push("relationships");
      const relationRows = relationshipsUnavailable
        ? []
        : uniqueRelations([
            ...((outgoingResult.data || []) as DbTaskRelation[]),
            ...((incomingResult.data || []) as DbTaskRelation[]),
          ]);
      const relatedIds = [...new Set(relationRows.flatMap((row) => [row.task_id, row.related_task_id]))]
        .filter((id) => id !== normalizedItemId);
      const relatedResult = relatedIds.length
        ? await supabase.from(ACTIVE_TASKS_TABLE).select(taskRowSelect).in("id", relatedIds)
        : { data: [] as DbTask[], error: null };
      if (relatedResult.error) {
        if (!unavailable.includes("relationships")) unavailable.push("relationships");
      }

      const coreRows = uniqueRows([
        target,
        ...ancestorsResult.rows,
        ...((childrenResult.data || []) as DbTask[]),
        ...((relatedResult.data || []) as DbTask[]),
      ]);
      const supporting = await loadSupportingRows(supabase, coreRows.map((row) => row.id));
      if (supporting.error) return { status: "unavailable" };
      const tasks = mapTasks(coreRows, people, supporting);
      const tasksById = byIds(tasks);
      const item = tasksById.get(normalizedItemId);
      if (!item) return { status: "unavailable" };

      const [comments, externalComments, blockers, activity, reviews] = await Promise.all([
        supabase.from("task_comments").select("id,task_id,profile_id,comment,created_at,github_delivery_applicable,task_comment_github_deliveries(status,github_comment_url)").eq("task_id", normalizedItemId).order("created_at", { ascending: false }).limit(taskDetailReadLimits.comments),
        supabase.from("task_external_comments").select("id,task_id,source,external_id,author_login,author_avatar_url,body,html_url,created_at,imported_at").eq("task_id", normalizedItemId).order("created_at", { ascending: false }).limit(taskDetailReadLimits.externalComments),
        supabase.from("task_blockers").select("id,task_id,profile_id,reason,impact,needs_help_from,status,created_at,resolved_at").eq("task_id", normalizedItemId).order("created_at", { ascending: false }).limit(taskDetailReadLimits.blockers),
        supabase.from("task_audit_timeline").select("id,task_id,action,actor_profile_id,message,payload,created_at").eq("task_id", normalizedItemId).order("created_at", { ascending: true }).limit(taskDetailReadLimits.activity),
        supabase.from("task_reviews").select("id,task_id,sprint_id,reviewer_profile_id,decision,points,comment,checklist,created_at,task_review_github_deliveries(status,github_comment_url)").eq("task_id", normalizedItemId).order("created_at", { ascending: false }).limit(taskDetailReadLimits.reviews),
      ]);

      const discussionUnavailable = Boolean(comments.error || externalComments.error);
      if (discussionUnavailable) unavailable.push("discussion");
      const timelineUnavailable = Boolean(activity.error || reviews.error);
      if (timelineUnavailable) unavailable.push("timeline");
      if (blockers.error && !unavailable.includes("relationships")) unavailable.push("relationships");

      const model: TaskDetailModel = {
        revision: item.updatedAt || target.updated_at,
        coverage: {
          discussion: (comments.data?.length || 0) < taskDetailReadLimits.comments && (externalComments.data?.length || 0) < taskDetailReadLimits.externalComments ? "complete" : "partial",
          relationships: (outgoingResult.data?.length || 0) < taskDetailReadLimits.relationships && (incomingResult.data?.length || 0) < taskDetailReadLimits.relationships && (blockers.data?.length || 0) < taskDetailReadLimits.blockers ? "complete" : "partial",
          timeline: (activity.data?.length || 0) < taskDetailReadLimits.activity && (reviews.data?.length || 0) < taskDetailReadLimits.reviews ? "complete" : "partial",
        },
        project: project(projectResult.data),
        item,
        ancestors: ancestorsResult.rows.flatMap((row) => tasksById.get(row.id) || []),
        children: ((childrenResult.data || []) as DbTask[]).flatMap((row) => tasksById.get(row.id) || []),
        relatedItems: relatedResult.error
          ? []
          : relatedIds.flatMap((id) => tasksById.get(id) || []),
        people,
        sprints: ((sprintResult.data || []) as DbSprint[]).map(mapSprint),
        discussion: {
          comments: discussionUnavailable ? [] : ((comments.data || []) as DbTaskComment[]).map(mapTaskComment),
          externalComments: discussionUnavailable ? [] : ((externalComments.data || []) as DbTaskExternalComment[]).map(mapTaskExternalComment),
        },
        blockers: blockers.error ? [] : ((blockers.data || []) as DbTaskBlocker[]).map(mapTaskBlocker),
        relationships: relationshipsUnavailable ? [] : relationRows.map(mapTaskRelation),
        activity: timelineUnavailable ? [] : ((activity.data || []) as DbTaskAuditActivity[]).map(mapTaskAuditActivity),
        reviews: timelineUnavailable ? [] : ((reviews.data || []) as DbTaskReview[]).map(mapTaskReview),
      };
      return unavailable.length
        ? { status: "degraded", model, unavailable }
        : { status: "ready", model };
    },
  };
}
