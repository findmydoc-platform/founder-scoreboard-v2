import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanningWorkspaceLoadContext, PlanningWorkspaceLoadResult } from "@/features/planning-items/model/planning-workspace-model";
import { mapTaskRelation } from "@/lib/planning-data-mappers";
import type {
  DbPlanningItemRaciAssignment,
  DbPlanningItemStrategy,
  DbProfile,
  DbProfileUiPreference,
  DbSprint,
  DbTask,
  DbTaskLink,
  DbTaskRelation,
} from "@/lib/planning-data-row-types";
import { taskRowSelect } from "@/lib/planning-data-row-types";
import { mapProfile, mapProfileUiPreference } from "@/lib/planning-profile-mappers";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { mapSprint } from "@/lib/planning-sprint-mappers";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS } from "@/lib/sprint-review-window";
import type { Profile, Project } from "@/lib/types";

const projectId = "findmydoc-founder-execution";
const profileSelect = "id,name,role,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color,google_chat_user_id,google_chat_dm_space,notifications_enabled";

type ProjectRow = {
  id: string;
  name: string;
  range_label: string | null;
  review_objection_window_hours: number | null;
  github_project_owner: string | null;
  github_project_number: number | null;
};

function mapProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    range: row.range_label || "",
    reviewObjectionWindowHours: Number(row.review_objection_window_hours || DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS),
    githubProjectOwner: row.github_project_owner || "findmydoc-platform",
    githubProjectNumber: Number(row.github_project_number || 21),
  };
}

function mapItems(rows: DbTask[], people: Profile[], links: DbTaskLink[], strategies: DbPlanningItemStrategy[], assignments: DbPlanningItemRaciAssignment[]) {
  const linksById = new Map<string, DbTaskLink[]>();
  for (const link of links) linksById.set(link.task_id, [...(linksById.get(link.task_id) || []), link]);
  const strategyById = new Map(strategies.map((strategy) => [strategy.task_id, strategy]));
  const assignmentsById = new Map<string, DbPlanningItemRaciAssignment[]>();
  for (const assignment of assignments) assignmentsById.set(assignment.task_id, [...(assignmentsById.get(assignment.task_id) || []), assignment]);
  const items = rows.map((row) => mapTaskRow(row, people, {
    taskLinks: linksById.get(row.id) || [],
    strategy: strategyById.get(row.id),
    raciAssignments: assignmentsById.get(row.id) || [],
  }));
  const approvalById = new Map(items.map((item) => [item.id, item.approvalStatus]));
  return items.map((item) => item.parentTaskId ? { ...item, parentApprovalStatus: approvalById.get(item.parentTaskId) || null } : item);
}

export async function loadPlanningWorkspaceModel(
  supabase: SupabaseClient,
  context: PlanningWorkspaceLoadContext,
): Promise<PlanningWorkspaceLoadResult> {
  if (!context.authorized) return { status: "forbidden" };
  const [projectResult, profileResult, itemResult, strategyResult, raciResult, linkResult, sprintResult, relationResult, preferenceResult] = await Promise.all([
    supabase.from("projects").select("id,name,range_label,review_objection_window_hours,github_project_owner,github_project_number").eq("id", projectId).single<ProjectRow>(),
    supabase.from("profiles").select(profileSelect).order("name"),
    supabase.from(ACTIVE_TASKS_TABLE).select(taskRowSelect).eq("project_id", projectId).order("sort_order").order("id"),
    supabase.from("planning_item_strategy").select("task_id,goal,success_criteria,scope_constraints"),
    supabase.from("planning_item_raci_assignments").select("task_id,profile_id,role,sort_order").order("task_id").order("sort_order"),
    supabase.from("task_links").select("id,task_id,type,label,url,position,metadata").order("position").order("id"),
    supabase.from("sprints").select("id,name,status,start_date,end_date,review_due_at,score_locked").order("start_date").order("id"),
    supabase.from("task_relationship_edges").select("id,task_id,related_task_id,relation_type,note,created_by,created_at").order("created_at", { ascending: false }).order("id").limit(500),
    supabase.from("profile_ui_preferences").select("profile_id,default_workspace,default_task_view,planning_filters,expanded_package_ids,created_at,updated_at").order("profile_id"),
  ]);
  if (projectResult.error || !projectResult.data || profileResult.error || itemResult.error || strategyResult.error || raciResult.error || linkResult.error || sprintResult.error || relationResult.error || preferenceResult.error) {
    return { status: "unavailable" };
  }
  const people = ((profileResult.data || []) as DbProfile[]).map(mapProfile);
  const items = mapItems(
    (itemResult.data || []) as unknown as DbTask[],
    people,
    (linkResult.data || []) as DbTaskLink[],
    (strategyResult.data || []) as DbPlanningItemStrategy[],
    (raciResult.data || []) as DbPlanningItemRaciAssignment[],
  );
  const activeIds = new Set(items.map((item) => item.id));
  return {
    status: "ready",
    model: {
      revision: items.reduce((latest, item) => item.updatedAt && item.updatedAt > latest ? item.updatedAt : latest, ""),
      project: mapProject(projectResult.data),
      items,
      relationships: ((relationResult.data || []) as DbTaskRelation[])
        .filter((relation) => activeIds.has(relation.task_id) && activeIds.has(relation.related_task_id))
        .map(mapTaskRelation),
      people,
      sprints: ((sprintResult.data || []) as DbSprint[]).map(mapSprint),
      preferences: ((preferenceResult.data || []) as DbProfileUiPreference[]).map(mapProfileUiPreference),
    },
  };
}
