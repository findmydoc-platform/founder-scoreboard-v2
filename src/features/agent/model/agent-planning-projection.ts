import { agentConstraints, type AgentTaskFilters } from "@/features/agent/model/agent-contract";
import { normalizeStatus } from "@/lib/status";
import type { Package, PlanningData, Profile, Task, TaskBlocker, TaskComment, TaskExternalComment } from "@/lib/types";

type PlanningSource = "seed" | "supabase";

type TaskRelationCounts = {
  waitsOn: number;
  blocks: number;
  related: number;
};

type AgentPlanningIndex = {
  initiativeById: Map<string, Package>;
  profileById: Map<string, Profile>;
  taskById: Map<string, Task>;
  commentsByTaskId: Map<string, TaskComment[]>;
  externalCommentsByTaskId: Map<string, TaskExternalComment[]>;
  blockersByTaskId: Map<string, TaskBlocker[]>;
  relationCountsByTaskId: Map<string, TaskRelationCounts>;
  blockedTaskIds: Set<string>;
};

function appendToGroup<T>(groups: Map<string, T[]>, key: string, value: T) {
  const group = groups.get(key);
  if (group) group.push(value);
  else groups.set(key, [value]);
}

function relationCounts(index: AgentPlanningIndex, taskId: string) {
  let counts = index.relationCountsByTaskId.get(taskId);
  if (!counts) {
    counts = { waitsOn: 0, blocks: 0, related: 0 };
    index.relationCountsByTaskId.set(taskId, counts);
  }
  return counts;
}

export function buildAgentPlanningIndex(data: PlanningData): AgentPlanningIndex {
  const index: AgentPlanningIndex = {
    initiativeById: new Map(data.packages.map((initiative) => [initiative.id, initiative])),
    profileById: new Map(data.profiles.map((profile) => [profile.id, profile])),
    taskById: new Map(data.tasks.map((task) => [task.id, task])),
    commentsByTaskId: new Map(),
    externalCommentsByTaskId: new Map(),
    blockersByTaskId: new Map(),
    relationCountsByTaskId: new Map(),
    blockedTaskIds: new Set(),
  };

  for (const comment of data.taskComments) appendToGroup(index.commentsByTaskId, comment.taskId, comment);
  for (const comment of data.taskExternalComments) appendToGroup(index.externalCommentsByTaskId, comment.taskId, comment);
  for (const blocker of data.taskBlockers) {
    appendToGroup(index.blockersByTaskId, blocker.taskId, blocker);
  }

  for (const relation of data.taskRelations) {
    if (relation.relationType === "blocked_by") {
      relationCounts(index, relation.taskId).waitsOn += 1;
      relationCounts(index, relation.relatedTaskId).blocks += 1;
      const blockingTask = index.taskById.get(relation.relatedTaskId);
      if (index.taskById.has(relation.taskId) && blockingTask && normalizeStatus(blockingTask.status) !== "Erledigt") {
        index.blockedTaskIds.add(relation.taskId);
      }
    } else if (relation.relationType === "blocks") {
      relationCounts(index, relation.taskId).blocks += 1;
    } else {
      relationCounts(index, relation.taskId).related += 1;
      if (relation.relatedTaskId !== relation.taskId) relationCounts(index, relation.relatedTaskId).related += 1;
    }
  }

  for (const task of data.tasks) {
    if (normalizeStatus(task.status) === "Blockiert") index.blockedTaskIds.add(task.id);
  }

  return index;
}

function profilePublic(profile: Profile) {
  return {
    id: profile.id,
    name: profile.name,
    platformRole: profile.platformRole,
    githubLogin: profile.githubLogin,
  };
}

function initiativePublic(initiative: Package) {
  return {
    id: initiative.id,
    title: initiative.title,
    milestoneId: initiative.milestoneId || "",
    ownerId: initiative.ownerId || "",
    accountableProfileId: initiative.accountableProfileId || "",
    responsibleProfileIds: initiative.responsibleProfileIds || [],
    consultedProfileIds: initiative.consultedProfileIds || [],
    informedProfileIds: initiative.informedProfileIds || [],
    status: initiative.status || "planned",
    priority: initiative.priority,
    targetDate: initiative.targetDate || "",
    goal: initiative.goal,
    successCriteria: initiative.successCriteria || "",
    scopeConstraints: initiative.scopeConstraints || "",
  };
}

function taskMatchesAssignee(task: Task, assignee = "") {
  if (!assignee) return true;
  const normalized = assignee.toLowerCase();
  return task.assigneeId?.toLowerCase() === normalized
    || task.assignee.toLowerCase() === normalized
    || task.ownerId?.toLowerCase() === normalized
    || task.owner.toLowerCase() === normalized;
}

function taskHasEvidence(task: Task) {
  return Boolean(task.evidenceLink || task.githubIssueUrl || task.issueUrl);
}

function commentSummary(taskId: string, index: AgentPlanningIndex) {
  const comments = index.commentsByTaskId.get(taskId) || [];
  const externalComments = index.externalCommentsByTaskId.get(taskId) || [];
  return {
    internalCount: comments.length,
    externalCount: externalComments.length,
    latestInternalComment: comments[0]?.comment || "",
    latestExternalCommentUrl: externalComments[0]?.htmlUrl || "",
  };
}

function blockerSummary(taskId: string, index: AgentPlanningIndex) {
  const blockers = index.blockersByTaskId.get(taskId) || [];
  return {
    openCount: blockers.filter((blocker) => blocker.status === "open").length,
    latestReason: blockers[0]?.reason || "",
    latestImpact: blockers[0]?.impact || "",
  };
}

export function projectAgentContext(data: PlanningData, source: PlanningSource) {
  const index = buildAgentPlanningIndex(data);
  let openTaskCount = 0;
  let openReviewCount = 0;
  let tasksWithoutEvidenceCount = 0;

  for (const task of data.tasks) {
    if (normalizeStatus(task.status) !== "Erledigt") openTaskCount += 1;
    if (!task.scoreFinal && (normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested")) openReviewCount += 1;
    if (task.scoreRelevant && !taskHasEvidence(task)) tasksWithoutEvidenceCount += 1;
  }

  return {
    source,
    context: {
      project: data.project,
      profiles: data.profiles.map(profilePublic),
      sprints: data.sprints,
      milestones: data.milestones,
      initiatives: data.packages.map(initiativePublic),
      metrics: {
        taskCount: data.tasks.length,
        openTaskCount,
        openReviewCount,
        tasksWithoutEvidenceCount,
        blockedTaskCount: index.blockedTaskIds.size,
      },
      constraints: agentConstraints(),
    },
  };
}

export function projectAgentTasks(data: PlanningData, filters: AgentTaskFilters, source: PlanningSource) {
  const index = buildAgentPlanningIndex(data);
  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  const requestedAssignee = filters.assignee || filters.owner;
  const tasks = data.tasks
    .filter((task) => task.taskType !== "sub_issue")
    .filter((task) => taskMatchesAssignee(task, requestedAssignee))
    .filter((task) => !filters.sprint || task.sprintId === filters.sprint)
    .filter((task) => !filters.initiative || task.packageId === filters.initiative)
    .filter((task) => !filters.status || normalizeStatus(task.status) === normalizeStatus(filters.status))
    .filter((task) => !filters.reviewOwner || task.reviewOwnerProfileId === filters.reviewOwner)
    .filter((task) => !filters.missingEvidence || !taskHasEvidence(task))
    .filter((task) => !filters.blocked || index.blockedTaskIds.has(task.id))
    .slice(0, limit)
    .map((task) => {
      const initiative = index.initiativeById.get(task.packageId);
      const reviewOwner = index.profileById.get(task.reviewOwnerProfileId || "");
      const relations = index.relationCountsByTaskId.get(task.id) || { waitsOn: 0, blocks: 0, related: 0 };
      return {
        id: task.id,
        title: task.title,
        taskType: task.taskType,
        status: normalizeStatus(task.status),
        priority: task.priority,
        assigneeId: task.assigneeId || "",
        assignee: task.assignee,
        sprintId: task.sprintId,
        initiativeId: task.packageId,
        initiativeTitle: initiative?.title || "",
        reviewOwnerProfileId: task.reviewOwnerProfileId || "",
        reviewOwnerName: reviewOwner?.name || "",
        reviewStatus: task.reviewStatus,
        scoreFinal: task.scoreFinal,
        scorePoints: task.scorePoints,
        hours: task.hours,
        startDate: task.startDate,
        endDate: task.endDate,
        deadline: task.deadline,
        problemStatement: task.problemStatement || task.description,
        intendedOutcome: task.intendedOutcome || "",
        scopeConstraints: task.scopeConstraints || "",
        acceptanceCriteria: task.acceptanceCriteria || task.definitionOfDone,
        evidenceRequired: task.evidenceRequired || "",
        definitionOfDone: task.definitionOfDone,
        evidenceLink: task.evidenceLink || task.githubIssueUrl || task.issueUrl,
        githubIssueUrl: task.githubIssueUrl || task.issueUrl,
        missingEvidence: !taskHasEvidence(task),
        blocked: index.blockedTaskIds.has(task.id),
        blockers: blockerSummary(task.id, index),
        comments: commentSummary(task.id, index),
        relations,
        raci: {
          accountableProfileId: initiative?.accountableProfileId || "",
          responsibleProfileIds: initiative?.responsibleProfileIds || [],
          consultedProfileIds: initiative?.consultedProfileIds || [],
          informedProfileIds: initiative?.informedProfileIds || [],
        },
      };
    });

  return { source, filters: { ...filters, limit }, tasks };
}
