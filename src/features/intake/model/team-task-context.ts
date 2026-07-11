import { normalizeStatus } from "@/lib/status";
import type { getServerSupabase } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";
import { canCreateTeamSubIssueUnderDeliverable, TEAM_TASK_INTAKE_ALLOWED_TASK_TYPES, TEAM_TASK_INTAKE_MAX_TASKS } from "@/features/intake/model/team-task-intake";

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

export async function buildTeamTaskContext(supabase: SupabaseServer, actor: AuthenticatedProfile) {
  const [
    profilesResult,
    milestonesResult,
    initiativesResult,
    sprintsResult,
    tasksResult,
    blockersResult,
    relationsResult,
    commentsResult,
    externalCommentsResult,
  ] = await Promise.all([
    supabase.from("profiles").select("id,name").order("name"),
    supabase.from("milestones").select("id,title,status,target_date,sort_order").order("sort_order"),
    supabase.from("packages").select("id,title,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,status,priority,target_date,sort_order").order("sort_order"),
    supabase.from("sprints").select("id,name,status,start_date,end_date").order("start_date"),
    supabase
      .from("tasks")
      .select("id,title,description,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,definition_of_done,task_type,parent_task_id,status,priority,owner,assignee,created_by,package_id,milestone_id,sprint_id,workstream,start_date,end_date,deadline,estimate_hours,evidence_link,github_issue_url,issue_url")
      .order("sort_order"),
    supabase.from("task_blockers").select("task_id,status,reason,impact,created_at").order("created_at", { ascending: false }),
    supabase.from("task_relationship_edges").select("task_id,related_task_id,relation_type"),
    supabase.from("task_comments").select("task_id"),
    supabase.from("task_external_comments").select("task_id"),
  ]);

  const firstError = [
    profilesResult.error,
    milestonesResult.error,
    initiativesResult.error,
    sprintsResult.error,
    tasksResult.error,
    blockersResult.error,
    relationsResult.error,
    commentsResult.error,
    externalCommentsResult.error,
  ].find(Boolean);
  if (firstError) throw new Error(firstError.message);

  const blockers = blockersResult.data || [];
  const relations = relationsResult.data || [];
  const internalCommentCounts = countByTask(commentsResult.data || []);
  const externalCommentCounts = countByTask(externalCommentsResult.data || []);

  return {
    actor: {
      id: actor.id,
      name: actor.name,
      platformRole: actor.platformRole,
    },
    constraints: {
      allowedTaskTypes: TEAM_TASK_INTAKE_ALLOWED_TASK_TYPES,
      maxBatchSize: TEAM_TASK_INTAKE_MAX_TASKS,
      forbiddenWrites: [
        "deliverable",
        "score",
        "final-review",
        "review-owner",
        "sprint-configuration",
        "github-sync",
      ],
      subIssuePolicy: actor.platformRole === "founder" ? "own-deliverables-only" : "any-deliverable",
    },
    profiles: (profilesResult.data || []).map((profile) => ({
      id: profile.id,
      name: profile.name,
    })),
    milestones: (milestonesResult.data || []).map((milestone) => ({
      id: milestone.id,
      title: milestone.title,
      status: milestone.status,
      targetDate: milestone.target_date || "",
    })),
    initiatives: (initiativesResult.data || []).map((initiative) => ({
      id: initiative.id,
      title: initiative.title,
      milestoneId: initiative.milestone_id || "",
      ownerId: initiative.owner_id || "",
      accountableProfileId: initiative.accountable_profile_id || "",
      responsibleProfileIds: initiative.responsible_profile_ids || [],
      status: initiative.status || "planned",
      priority: initiative.priority || "",
      targetDate: initiative.target_date || "",
    })),
    sprints: (sprintsResult.data || []).map((sprint) => ({
      id: sprint.id,
      name: sprint.name,
      status: sprint.status,
      startDate: sprint.start_date || "",
      endDate: sprint.end_date || "",
    })),
    tasks: ((tasksResult.data || []) as TaskContextRow[]).map((task) => {
      const taskBlockers = blockers.filter((blocker) => blocker.task_id === task.id);
      const openBlockers = taskBlockers.filter((blocker) => blocker.status === "open");
      const taskRelations = relations.filter((relation) => relation.task_id === task.id || relation.related_task_id === task.id);
      const ownerId = task.assignee || task.owner || "";
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
        canCreateSubIssue: task.task_type === "deliverable" && canCreateTeamSubIssueUnderDeliverable({
          actorId: actor.id,
          actorRole: actor.platformRole,
          parentOwnerId: ownerId,
        }),
        blockers: {
          openCount: openBlockers.length,
          latestReason: openBlockers[0]?.reason || "",
          latestImpact: openBlockers[0]?.impact || "",
        },
        comments: {
          internalCount: internalCommentCounts.get(task.id) || 0,
          externalCount: externalCommentCounts.get(task.id) || 0,
        },
        relations: {
          count: taskRelations.length,
          blocks: taskRelations.filter((relation) => relation.task_id === task.id && relation.relation_type === "blocks").length,
          blockedBy: taskRelations.filter((relation) => relation.task_id === task.id && relation.relation_type === "blocked_by").length,
        },
      };
    }),
  };
}
