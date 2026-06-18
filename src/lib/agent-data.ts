import { getPlanningData } from "@/lib/planning-data";
import { hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { Package, PlanningData, Profile, Task } from "@/lib/types";

export type AgentTaskFilters = {
  owner?: string;
  sprint?: string;
  initiative?: string;
  status?: string;
  reviewOwner?: string;
  missingEvidence?: boolean;
  blocked?: boolean;
  limit?: number;
};

function profilePublic(profile: Profile) {
  return {
    id: profile.id,
    name: profile.name,
    platformRole: profile.platformRole,
    githubLogin: profile.githubLogin,
  };
}

function initiativePublic(pack: Package) {
  return {
    id: pack.id,
    title: pack.title,
    milestoneId: pack.milestoneId || "",
    ownerId: pack.ownerId || "",
    accountableProfileId: pack.accountableProfileId || "",
    responsibleProfileIds: pack.responsibleProfileIds || [],
    consultedProfileIds: pack.consultedProfileIds || [],
    informedProfileIds: pack.informedProfileIds || [],
    status: pack.status || "planned",
    priority: pack.priority,
    targetDate: pack.targetDate || "",
    goal: pack.goal,
    successCriteria: pack.successCriteria || "",
    scopeConstraints: pack.scopeConstraints || "",
  };
}

function taskMatchesOwner(task: Task, owner = "") {
  if (!owner) return true;
  const normalized = owner.toLowerCase();
  return task.ownerId?.toLowerCase() === normalized || task.owner.toLowerCase() === normalized || task.assigneeId?.toLowerCase() === normalized;
}

function taskHasEvidence(task: Task) {
  return Boolean(task.evidenceLink || task.githubIssueUrl || task.issueUrl);
}

function isBlocked(task: Task, data: PlanningData) {
  return normalizeStatus(task.status) === "Blockiert" || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations);
}

function commentSummary(task: Task, data: PlanningData) {
  const comments = data.taskComments.filter((comment) => comment.taskId === task.id);
  const externalComments = data.taskExternalComments.filter((comment) => comment.taskId === task.id);
  return {
    internalCount: comments.length,
    externalCount: externalComments.length,
    latestInternalComment: comments[0]?.comment || "",
    latestExternalCommentUrl: externalComments[0]?.htmlUrl || "",
  };
}

function blockerSummary(task: Task, data: PlanningData) {
  const blockers = data.taskBlockers.filter((blocker) => blocker.taskId === task.id);
  return {
    openCount: blockers.filter((blocker) => blocker.status === "open").length,
    latestReason: blockers[0]?.reason || "",
    latestImpact: blockers[0]?.impact || "",
  };
}

export function agentConstraints() {
  return {
    allowedActions: ["read:planning", "write:intake"],
    readCapabilities: ["context", "tasks"],
    writeCapabilities: ["task-intake-preview", "task-intake-commit"],
    forbiddenWrites: ["score", "scoreFinal", "reviewOwnerProfileId", "reviewStatusFinalization", "raci", "sprintConfiguration", "assigneeOverrideOutsideIntake"],
    sourceOfTruth: "FounderOps Supabase via guarded API",
    noDirectDatabaseCredentials: true,
    noAiModelInsideFounderOps: true,
  };
}

export async function buildAgentContext() {
  const { data, source } = await getPlanningData();
  const openReviewTasks = data.tasks.filter((task) => !task.scoreFinal && (normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested"));
  const tasksWithoutEvidence = data.tasks.filter((task) => task.scoreRelevant && !taskHasEvidence(task));
  const blockedTasks = data.tasks.filter((task) => isBlocked(task, data));

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
        openTaskCount: data.tasks.filter((task) => normalizeStatus(task.status) !== "Erledigt").length,
        openReviewCount: openReviewTasks.length,
        tasksWithoutEvidenceCount: tasksWithoutEvidence.length,
        blockedTaskCount: blockedTasks.length,
        decisionsOpenForConfirmation: data.decisions.filter((decision) => decision.status === "open_for_confirmation").length,
      },
      constraints: agentConstraints(),
    },
  };
}

export async function getAgentTasks(filters: AgentTaskFilters) {
  const { data, source } = await getPlanningData();
  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 200);
  const tasks = data.tasks
    .filter((task) => task.taskType !== "sub_issue")
    .filter((task) => taskMatchesOwner(task, filters.owner))
    .filter((task) => !filters.sprint || task.sprintId === filters.sprint)
    .filter((task) => !filters.initiative || task.packageId === filters.initiative)
    .filter((task) => !filters.status || normalizeStatus(task.status) === normalizeStatus(filters.status))
    .filter((task) => !filters.reviewOwner || task.reviewOwnerProfileId === filters.reviewOwner)
    .filter((task) => !filters.missingEvidence || !taskHasEvidence(task))
    .filter((task) => !filters.blocked || isBlocked(task, data))
    .slice(0, limit)
    .map((task) => {
      const initiative = data.packages.find((pack) => pack.id === task.packageId);
      const reviewOwner = data.profiles.find((profile) => profile.id === task.reviewOwnerProfileId);
      const relations = taskRelationsFor(task.id, data.taskRelations);
      return {
        id: task.id,
        title: task.title,
        taskType: task.taskType,
        status: normalizeStatus(task.status),
        priority: task.priority,
        ownerId: task.ownerId || "",
        owner: task.owner,
        assigneeId: task.assigneeId || "",
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
        blocked: isBlocked(task, data),
        blockers: blockerSummary(task, data),
        comments: commentSummary(task, data),
        relations: {
          waitsOn: relations.waitsOn.length,
          blocks: relations.blocks.length,
          related: relations.related.length,
        },
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
