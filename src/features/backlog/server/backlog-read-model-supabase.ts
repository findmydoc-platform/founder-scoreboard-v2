import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BacklogLoadResult, BacklogReadModel } from "@/features/backlog/model/backlog-read-model";
import type {
  DbPlanningItemRaciAssignment,
  DbPlanningItemStrategy,
  DbProfile,
  DbSprint,
  DbSprintCommitment,
  DbTask,
  DbTaskLink,
} from "@/lib/planning-row-types";
import { taskRowSelect } from "@/lib/planning-row-types";
import { mapProfile } from "@/lib/planning-profile-mappers";
import { mapSprint, mapSprintCommitment } from "@/lib/planning-sprint-mappers";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import type { Profile } from "@/lib/types";

const projectId = "findmydoc-founder-execution";
const profileSelect = "id,name,role,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color,google_chat_user_id,google_chat_dm_space,notifications_enabled";
const sprintSelect = "id,name,status,start_date,end_date,review_due_at,score_locked";
const commitmentSelect = "id,sprint_id,profile_id,commitment_level,weekly_hours,note";

function mapItems(
  rows: readonly DbTask[],
  people: Profile[],
  links: readonly DbTaskLink[],
  strategies: readonly DbPlanningItemStrategy[],
  raciAssignments: readonly DbPlanningItemRaciAssignment[],
) {
  const linksById = new Map<string, DbTaskLink[]>();
  for (const link of links) linksById.set(link.task_id, [...(linksById.get(link.task_id) || []), link]);
  const strategyById = new Map(strategies.map((strategy) => [strategy.task_id, strategy]));
  const raciById = new Map<string, DbPlanningItemRaciAssignment[]>();
  for (const assignment of raciAssignments) {
    raciById.set(assignment.task_id, [...(raciById.get(assignment.task_id) || []), assignment]);
  }
  const items = rows.map((row) => mapTaskRow(row, people, {
    taskLinks: linksById.get(row.id) || [],
    strategy: strategyById.get(row.id),
    raciAssignments: raciById.get(row.id) || [],
  }));
  const approvalById = new Map(items.map((item) => [item.id, item.approvalStatus]));
  return items.map((item) => item.parentTaskId
    ? { ...item, parentApprovalStatus: approvalById.get(item.parentTaskId) || null }
    : item);
}

export function createSupabaseBacklogReadModel(supabase: SupabaseClient): BacklogReadModel {
  return {
    async load(context): Promise<BacklogLoadResult> {
      if (!context.authorized) return { status: "forbidden" };
      const [profileResult, itemResult, strategyResult, raciResult, linkResult, sprintResult, commitmentResult] = await Promise.all([
        supabase.from("profiles").select(profileSelect).order("name"),
        supabase.from(ACTIVE_TASKS_TABLE).select(taskRowSelect).eq("project_id", projectId).order("sort_order").order("id"),
        supabase.from("planning_item_strategy").select("task_id,goal,success_criteria,scope_constraints"),
        supabase.from("planning_item_raci_assignments").select("task_id,profile_id,role,sort_order").order("task_id").order("sort_order"),
        supabase.from("task_links").select("id,task_id,type,label,url,position,metadata").order("position").order("id"),
        supabase.from("sprints").select(sprintSelect).order("start_date").order("id"),
        supabase.from("sprint_commitments").select(commitmentSelect).order("profile_id").order("id"),
      ]);
      if (profileResult.error || itemResult.error || strategyResult.error || raciResult.error || linkResult.error || sprintResult.error || commitmentResult.error) {
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
      const revision = items.reduce((latest, item) => item.updatedAt && item.updatedAt > latest ? item.updatedAt : latest, "");
      return {
        status: "ready",
        model: {
          revision,
          items,
          people,
          sprints: ((sprintResult.data || []) as DbSprint[]).map(mapSprint),
          commitments: ((commitmentResult.data || []) as DbSprintCommitment[]).map(mapSprintCommitment),
        },
      };
    },
  };
}
