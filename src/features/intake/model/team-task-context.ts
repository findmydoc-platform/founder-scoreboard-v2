import { normalizeStatus } from "@/lib/status";
import type { getServerSupabase } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";
import {
  TEAM_TASK_INTAKE_ALLOWED_ITEM_TYPES,
  TEAM_TASK_INTAKE_FORBIDDEN_WRITES,
  TEAM_TASK_INTAKE_MAX_TASKS,
} from "@/features/intake/model/team-task-intake-contract";
import {
  mapTeamTaskContextInitiative,
  TEAM_TASK_CONTEXT_INITIATIVE_SELECT,
  type TeamTaskContextInitiativeRow,
} from "@/features/intake/model/team-task-context-initiative";
import { loadAllSupabaseRows } from "@/features/intake/model/supabase-pagination";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;

type TaskContextRow = {
  id: string;
  title: string;
  description: string | null;
  problem_statement: string | null;
  intended_outcome: string | null;
  scope_constraints: string | null;
  acceptance_criteria: string | null;
  evidence_required: string | null;
  definition_of_done: string | null;
  task_type: string | null;
  parent_task_id: string | null;
  status: string | null;
  priority: string | null;
  owner: string | null;
  assignee: string | null;
  created_by: string | null;
  package_id: string | null;
  milestone_id: string | null;
  sprint_id: string | null;
  workstream: string | null;
  start_date: string | null;
  end_date: string | null;
  deadline: string | null;
  estimate_hours: number | null;
  evidence_link: string | null;
  github_issue_url: string | null;
  issue_url: string | null;
};

function countByTask(rows: Array<{ task_id: string }>) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.task_id, (counts.get(row.task_id) || 0) + 1);
  return counts;
}

function groupByTask<T extends { task_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(row.task_id) || [];
    bucket.push(row);
    grouped.set(row.task_id, bucket);
  }
  return grouped;
}

export function relationStatsByTask(rows: Array<{ task_id: string; related_task_id: string; relation_type: string }>) {
  const stats = new Map<string, { count: number; blocks: number; blockedBy: number }>();
  const ensure = (taskId: string) => {
    const current = stats.get(taskId) || { count: 0, blocks: 0, blockedBy: 0 };
    stats.set(taskId, current);
    return current;
  };
  for (const relation of rows) {
    ensure(relation.task_id).count += 1;
    if (relation.related_task_id !== relation.task_id) ensure(relation.related_task_id).count += 1;
    if (relation.relation_type === "blocks") {
      ensure(relation.task_id).blocks += 1;
      if (relation.related_task_id !== relation.task_id) ensure(relation.related_task_id).blockedBy += 1;
    }
    if (relation.relation_type === "blocked_by") {
      ensure(relation.task_id).blockedBy += 1;
      if (relation.related_task_id !== relation.task_id) ensure(relation.related_task_id).blocks += 1;
    }
  }
  return stats;
}

export async function buildTeamTaskContext(supabase: SupabaseServer, actor: AuthenticatedProfile) {
  const [profiles, milestones, initiatives, sprints, tasks, blockers, relations, comments, externalComments] = await Promise.all([
    loadAllSupabaseRows((from, to) => supabase.from("profiles").select("id,name").order("name").order("id").range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("milestones").select("id,title,status,target_date,sort_order").order("sort_order").order("id").range(from, to)),
    loadAllSupabaseRows<TeamTaskContextInitiativeRow>((from, to) => supabase.from("packages").select(TEAM_TASK_CONTEXT_INITIATIVE_SELECT).order("sort_order").order("id").range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("sprints").select("id,name,status,start_date,end_date").order("start_date").order("id").range(from, to)),
    loadAllSupabaseRows<TaskContextRow>((from, to) => supabase
      .from("tasks")
      .select("id,title,description,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,definition_of_done,task_type,parent_task_id,status,priority,owner,assignee,created_by,package_id,milestone_id,sprint_id,workstream,start_date,end_date,deadline,estimate_hours,evidence_link,github_issue_url,issue_url")
      .order("sort_order")
      .order("id")
      .range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("task_blockers").select("task_id,status,reason,impact,created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("task_relationship_edges").select("task_id,related_task_id,relation_type").order("id").range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("task_comments").select("task_id").order("id").range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("task_external_comments").select("task_id").order("id").range(from, to)),
  ]);

  const blockersByTaskId = groupByTask(blockers);
  const relationStats = relationStatsByTask(relations);
  const internalCommentCounts = countByTask(comments);
  const externalCommentCounts = countByTask(externalComments);

  return {
    actor: {
      id: actor.id,
      name: actor.name,
      platformRole: actor.platformRole,
    },
    constraints: {
      allowedItemTypes: TEAM_TASK_INTAKE_ALLOWED_ITEM_TYPES,
      maxBatchSize: TEAM_TASK_INTAKE_MAX_TASKS,
      forbiddenWrites: TEAM_TASK_INTAKE_FORBIDDEN_WRITES,
      subIssuePolicy: "any-deliverable",
    },
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
    })),
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      status: milestone.status,
      targetDate: milestone.target_date || "",
    })),
    initiatives: initiatives.map(mapTeamTaskContextInitiative),
    sprints: sprints.map((sprint) => ({
      id: sprint.id,
      name: sprint.name,
      status: sprint.status,
      startDate: sprint.start_date || "",
      endDate: sprint.end_date || "",
    })),
    tasks: tasks.map((task) => {
      const taskBlockers = blockersByTaskId.get(task.id) || [];
      const openBlockers = taskBlockers.filter((blocker) => blocker.status === "open");
      const taskRelationStats = relationStats.get(task.id) || { count: 0, blocks: 0, blockedBy: 0 };
      return {
        id: task.id,
        title: task.title,
        taskType: task.task_type || "deliverable",
        parentTaskId: task.parent_task_id || "",
        status: normalizeStatus(task.status || ""),
        priority: task.priority || "P2",
        ownerId: task.owner || "",
        assigneeId: task.assignee || "",
        createdById: task.created_by || "",
        initiativeId: task.package_id || "",
        milestoneId: task.milestone_id || "",
        sprintId: task.sprint_id || "",
        workstream: task.workstream || "",
        startDate: task.start_date || "",
        endDate: task.end_date || "",
        deadline: task.deadline || "",
        hours: task.estimate_hours || 0,
        problemStatement: task.problem_statement || task.description || "",
        intendedOutcome: task.intended_outcome || "",
        scopeConstraints: task.scope_constraints || "",
        acceptanceCriteria: task.acceptance_criteria || "",
        evidenceRequired: task.evidence_required || "",
        definitionOfDone: task.definition_of_done || "",
        evidencePresent: Boolean(task.evidence_link || task.github_issue_url || task.issue_url),
        canCreateSubIssue: task.task_type === "deliverable",
        blockers: {
          openCount: openBlockers.length,
          latestReason: openBlockers[0]?.reason || "",
          latestImpact: openBlockers[0]?.impact || "",
        },
        comments: {
          internalCount: internalCommentCounts.get(task.id) || 0,
          externalCount: externalCommentCounts.get(task.id) || 0,
        },
        relations: taskRelationStats,
      };
    }),
  };
}
