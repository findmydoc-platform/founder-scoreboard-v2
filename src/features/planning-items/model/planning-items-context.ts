import { normalizeStatus, normalizeSubIssueStatus } from "@/lib/status";
import type { getServerSupabase } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";
import {
  FOUNDEROPS_PLANNING_PROJECT_ID,
  TEAM_PLANNING_ITEMS_FORBIDDEN_WRITES,
  TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE,
  TEAM_PLANNING_ITEM_TYPES,
} from "@/features/planning-items/model/planning-items-contract";
import { loadAllSupabaseRows } from "@/features/planning-items/model/supabase-pagination";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";

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
  task_type: "epic" | "initiative" | "deliverable" | "sub_issue" | null;
  parent_task_id: string | null;
  status: string | null;
  priority: string | null;
  owner: string | null;
  assignee: string | null;
  created_by: string | null;
  sprint_id: string | null;
  workstream: string | null;
  start_date: string | null;
  end_date: string | null;
  deadline: string | null;
  estimate_hours: number | null;
  evidence_link: string | null;
  github_issue_url: string | null;
  issue_url: string | null;
  github_repo: string | null;
  github_issue_sync_status: string | null;
  approval_status: string | null;
  approval_revision: number | null;
  target_date: string | null;
  sort_order: number | null;
  updated_at: string | null;
};

type StrategyRow = {
  task_id: string;
  goal: string | null;
  success_criteria: string | null;
  scope_constraints: string | null;
};

type RaciRow = {
  task_id: string;
  profile_id: string;
  role: "accountable" | "responsible" | "consulted" | "informed";
  sort_order: number;
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

function strategyFor(task: TaskContextRow, strategy?: StrategyRow) {
  if (task.task_type !== "initiative") return undefined;
  return {
    goal: strategy?.goal || task.description || "",
    successCriteria: strategy?.success_criteria || "",
    scopeConstraints: strategy?.scope_constraints || task.scope_constraints || "",
  };
}

function raciFor(rows: RaciRow[] = []) {
  return rows
    .slice()
    .sort((left, right) => left.sort_order - right.sort_order || left.profile_id.localeCompare(right.profile_id))
    .map((row) => ({ profileId: row.profile_id, role: row.role, sortOrder: row.sort_order }));
}

export function planningItemsInitiativeCompatibilityProjection<
  T extends {
    description: string;
    scopeConstraints: string;
    strategy?: {
      goal: string;
      successCriteria: string;
      scopeConstraints: string;
    };
  },
>(item: T) {
  return {
    ...item,
    goal: item.strategy?.goal || item.description,
    successCriteria: item.strategy?.successCriteria || "",
    scopeConstraints: item.strategy?.scopeConstraints || item.scopeConstraints,
  };
}

export async function buildPlanningItemsContext(supabase: SupabaseServer, actor: AuthenticatedProfile) {
  const [profiles, sprints, tasks, strategies, raciAssignments, blockers, relations, comments, externalComments] = await Promise.all([
    loadAllSupabaseRows((from, to) => supabase.from("profiles").select("id,name").order("name").order("id").range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("sprints").select("id,name,status,start_date,end_date").order("start_date").order("id").range(from, to)),
    loadAllSupabaseRows<TaskContextRow>((from, to) => supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("id,title,description,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,definition_of_done,task_type,parent_task_id,status,priority,owner,assignee,created_by,sprint_id,workstream,start_date,end_date,deadline,estimate_hours,evidence_link,github_issue_url,issue_url,github_repo,github_issue_sync_status,approval_status,approval_revision,target_date,sort_order,updated_at")
      .eq("project_id", FOUNDEROPS_PLANNING_PROJECT_ID)
      .order("sort_order")
      .order("id")
      .range(from, to)),
    loadAllSupabaseRows<StrategyRow>((from, to) => supabase
      .from("planning_item_strategy")
      .select("task_id,goal,success_criteria,scope_constraints")
      .order("task_id")
      .range(from, to)),
    loadAllSupabaseRows<RaciRow>((from, to) => supabase
      .from("planning_item_raci_assignments")
      .select("task_id,profile_id,role,sort_order")
      .order("task_id")
      .order("sort_order")
      .range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("task_blockers").select("task_id,status,reason,impact,created_at").order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("task_relationship_edges").select("task_id,related_task_id,relation_type").order("id").range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("task_comments").select("task_id").order("id").range(from, to)),
    loadAllSupabaseRows((from, to) => supabase.from("task_external_comments").select("task_id").order("id").range(from, to)),
  ]);

  const blockersByTaskId = groupByTask(blockers);
  const strategiesByTaskId = new Map(strategies.map((strategy) => [strategy.task_id, strategy]));
  const raciByTaskId = groupByTask(raciAssignments);
  const relationStats = relationStatsByTask(relations);
  const internalCommentCounts = countByTask(comments);
  const externalCommentCounts = countByTask(externalComments);
  const items = tasks.map((task) => {
    const itemType = task.task_type || "deliverable";
    const isSubIssue = itemType === "sub_issue";
    const isStrategic = itemType === "epic" || itemType === "initiative";
    const description = isSubIssue && !task.description?.trim()
      ? task.problem_statement || ""
      : task.description || "";
    const taskBlockers = blockersByTaskId.get(task.id) || [];
    const openBlockers = taskBlockers.filter((blocker) => blocker.status === "open");
    const taskRelationStats = relationStats.get(task.id) || { count: 0, blocks: 0, blockedBy: 0 };
    const strategy = strategyFor(task, strategiesByTaskId.get(task.id));
    const raciAssignmentsForItem = raciFor(raciByTaskId.get(task.id));

    return {
      id: task.id,
      itemType,
      title: task.title,
      description,
      parentTaskId: task.parent_task_id || "",
      status: isSubIssue ? normalizeSubIssueStatus(task.status || "") : normalizeStatus(task.status || ""),
      priority: itemType === "epic" ? "" : task.priority || "P2",
      ownerId: task.owner || "",
      assigneeId: task.assignee || "",
      createdById: task.created_by || "",
      targetDate: task.target_date || "",
      sortOrder: task.sort_order || 0,
      strategy,
      raciAssignments: raciAssignmentsForItem,
      approvalStatus: isStrategic || itemType === "deliverable" ? task.approval_status || null : null,
      approvalRevision: Number(task.approval_revision || 1),
      sprintId: itemType === "deliverable" ? task.sprint_id || "" : "",
      workstream: isStrategic || isSubIssue ? "" : task.workstream || "",
      startDate: isStrategic || isSubIssue ? "" : task.start_date || "",
      endDate: isStrategic || isSubIssue ? "" : task.end_date || "",
      deadline: isStrategic || isSubIssue ? "" : task.deadline || "",
      hours: isStrategic || isSubIssue ? 0 : task.estimate_hours || 0,
      problemStatement: task.problem_statement || (isSubIssue ? "" : task.description || ""),
      intendedOutcome: task.intended_outcome || "",
      scopeConstraints: task.scope_constraints || "",
      acceptanceCriteria: task.acceptance_criteria || "",
      evidenceRequired: task.evidence_required || "",
      definitionOfDone: task.definition_of_done || "",
      githubRepo: isStrategic ? "" : task.github_repo || "",
      githubIssueSyncStatus: isStrategic ? "not_applicable" : task.github_issue_sync_status || "not_synced",
      updatedAt: task.updated_at || "",
      evidencePresent: itemType === "deliverable" && Boolean(task.evidence_link || task.github_issue_url || task.issue_url),
      canCreateSubIssue: itemType === "deliverable",
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
  });

  const epics = items.filter((item) => item.itemType === "epic");
  const initiatives = items
    .filter((item) => item.itemType === "initiative")
    .map(planningItemsInitiativeCompatibilityProjection);
  const deliveryItems = items.filter((item) => item.itemType === "deliverable" || item.itemType === "sub_issue");

  return {
    actor: { id: actor.id, name: actor.name, platformRole: actor.platformRole },
    constraints: {
      allowedItemTypes: ["ceo", "deputy"].includes(actor.platformRole)
        ? TEAM_PLANNING_ITEM_TYPES
        : TEAM_PLANNING_ITEM_TYPES.filter((itemType) => itemType !== "epic"),
      maxBatchSize: TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE,
      forbiddenWrites: TEAM_PLANNING_ITEMS_FORBIDDEN_WRITES,
      subIssuePolicy: "approved-deliverable",
    },
    profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name })),
    items,
    epics,
    initiatives,
    tasks: deliveryItems,
    // Deprecated v1 projection; the source remains the canonical Epic list.
    milestones: epics.map((epic) => ({ ...epic, itemType: "milestone" as const })),
    sprints: sprints.map((sprint) => ({
      id: sprint.id,
      name: sprint.name,
      status: sprint.status,
      startDate: sprint.start_date || "",
      endDate: sprint.end_date || "",
    })),
  };
}
