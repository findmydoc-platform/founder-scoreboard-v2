import { describe, expect, it } from "vitest";
import {
  activeTaskDetailDependencyRows,
  taskDetailOperationalHeaderView,
} from "@/features/tasks/model/task-detail-operational-header-view";
import { taskDetailPlanningView } from "@/features/tasks/model/task-detail-planning-view";
import type { Profile, Sprint, Task, TaskRelation } from "@/lib/types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    order: 0,
    title: "Task",
    description: "",
    status: "Offen",
    priority: "P2",
    assignee: "",
    owner: "",
    workstream: "",
    fixedDate: "",
    definitionOfDone: "",
    dependsOn: "",
    evidenceLink: "",
    evidenceLinks: [],
    linkedPullRequests: [],
    issueNumber: "",
    issueUrl: "",
    note: "",
    watched: false,
    hours: 0,
    sprintId: "",
    reviewStatus: "not_requested",
    scorePoints: 0,
    scoreFinal: false,
    githubRepo: "management",
    githubIssueNumber: null,
    githubIssueUrl: "",
    githubIssueSyncStatus: "not_synced",
    githubIssueLastSyncedAt: "",
    githubIssueSyncError: "",
    taskType: "deliverable",
    parentTaskId: "",
    approvalStatus: "approved",
    approvalRevision: 1,
    parentApprovalStatus: "approved",
    scoreRelevant: true,
    ...overrides,
  };
}

const profiles: Profile[] = [
  {
    id: "founder-1",
    name: "Sebastian",
    role: "Founder",
    platformRole: "founder",
    color: "blue",
    avatarUrl: "",
    email: "",
    githubLogin: "",
  },
];

describe("task detail operational header view", () => {
  it("projects the deliverable hierarchy, accountable owner, child progress, and fixed date", () => {
    const initiative = task({
      id: "initiative-1",
      title: "Parent Initiative",
      taskType: "initiative",
      ownerId: "founder-1",
    });
    const deliverable = task({
      id: "deliverable-1",
      parentTaskId: initiative.id,
      fixedDate: "2026-09-12",
    });

    expect(taskDetailOperationalHeaderView({
      task: deliverable,
      initiative,
      profiles,
      subIssues: [
        task({ id: "child-1", taskType: "sub_issue", parentTaskId: deliverable.id, status: "Erledigt" }),
        task({ id: "child-2", taskType: "sub_issue", parentTaskId: deliverable.id, status: "In Arbeit" }),
      ],
      canManageTaskMeta: false,
    })).toMatchObject({
      hierarchyTask: initiative,
      hierarchyFallback: "Ohne Initiative",
      accountableLabel: "Sebastian",
      directChildLabel: "Sub-Issues",
      directChildCount: 2,
      completedChildCount: 1,
      targetDate: "2026-09-12",
      showTargetDate: true,
    });
  });

  it("keeps a missing initiative non-interactive and filters completed dependencies", () => {
    const deliverable = task({ id: "deliverable-1" });
    const relation = { id: "relation-1" } as TaskRelation;

    expect(taskDetailOperationalHeaderView({
      task: deliverable,
      profiles: [],
      subIssues: [],
      canManageTaskMeta: false,
    }).hierarchyTask).toBeUndefined();
    expect(taskDetailOperationalHeaderView({
      task: deliverable,
      profiles: [],
      subIssues: [],
      canManageTaskMeta: false,
    }).hierarchyFallback).toBe("Ohne Initiative");
    expect(activeTaskDetailDependencyRows([
      { relation, task: task({ id: "open", status: "Offen" }) },
      { relation: { ...relation, id: "relation-2" }, task: task({ id: "done", status: "Erledigt" }) },
      { relation: { ...relation, id: "relation-3" } },
    ])).toHaveLength(1);
  });
});

describe("task detail planning view", () => {
  const sprint: Sprint = {
    id: "sprint-1",
    name: "Sprint 1",
    status: "active",
    startDate: "2026-06-02",
    endDate: "2026-06-04",
    reviewDueAt: "2026-06-05T10:00:00.000Z",
    scoreLocked: false,
  };

  it("projects strategic hierarchy without exposing it before the component expands", () => {
    const epic = task({ id: "epic-1", title: "Parent Epic", taskType: "epic" });
    const initiative = task({
      id: "initiative-1",
      title: "Initiative",
      taskType: "initiative",
      parentTaskId: epic.id,
      targetDate: "2026-08-30",
    });

    expect(taskDetailPlanningView({
      task: initiative,
      allTasks: [epic, initiative],
      sprints: [],
      canManageTaskMeta: false,
      canReparentSubIssue: false,
    })).toMatchObject({
      kind: "strategic",
      currentParent: epic,
      targetDate: "2026-08-30",
      canEditPlanning: false,
    });
  });

  it("projects the assigned sprint and initiative for a deliverable", () => {
    const initiative = task({ id: "initiative-1", title: "Parent Initiative", taskType: "initiative" });
    const deliverable = task({ parentTaskId: initiative.id, sprintId: sprint.id });

    expect(taskDetailPlanningView({
      task: deliverable,
      allTasks: [initiative, deliverable],
      sprints: [sprint],
      canManageTaskMeta: false,
      canReparentSubIssue: false,
    })).toMatchObject({
      kind: "deliverable",
      currentParent: initiative,
      currentInitiative: initiative,
      currentSprint: sprint,
      sprintPeriod: "02.–04. Juni",
      canEditPlanning: false,
    });
  });
});
