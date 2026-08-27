import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKLOG_FILTERS,
  buildBacklogOverviewViewModel,
} from "@/features/backlog/model/backlog-view-model";
import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { Profile, Task } from "@/lib/types";

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id || "task",
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

const owner = {
  id: "founder-1",
  name: "Sebastian",
  weeklyCapacity: 20,
} as Profile;

const model: BacklogModel = {
  revision: "revision-1",
  items: [
    task({ id: "epic-1", title: "Growth", taskType: "epic" }),
    task({ id: "initiative-1", title: "Clinic growth", taskType: "initiative", parentTaskId: "epic-1", assigneeId: owner.id }),
    task({ id: "initiative-2", title: "Operations", taskType: "initiative", parentTaskId: "", priority: "P1" }),
    task({ id: "deliverable-1", title: "Onboarding", taskType: "deliverable", parentTaskId: "initiative-1" }),
  ],
  people: [owner],
  sprints: [],
  commitments: [],
};

describe("backlog overview view", () => {
  it("filters strategic levels with their applicable parent and people fields", () => {
    const view = buildBacklogOverviewViewModel(model, {
      ...DEFAULT_BACKLOG_FILTERS,
      level: "initiative",
      query: "clinic",
      epic: "epic-1",
      assignee: owner.id,
    }, true);

    expect(view.visibleLevelTasks.map((item) => item.id)).toEqual(["initiative-1"]);
    expect(view.activeFilters).toEqual([
      { id: "epic", label: "Epic: Growth", reset: { epic: "Alle" } },
      { id: "assignee", label: "Zuständig: Sebastian", reset: { assignee: "Alle" } },
    ]);
    expect(view.filterOptions.epics).toContainEqual({ value: "epic-1", label: "Growth" });
  });

  it("enables rank editing only for the unfiltered ascending deliverable rank", () => {
    expect(buildBacklogOverviewViewModel(model, DEFAULT_BACKLOG_FILTERS, true).rankEditingEnabled).toBe(true);
    expect(buildBacklogOverviewViewModel(model, {
      ...DEFAULT_BACKLOG_FILTERS,
      query: "onboarding",
    }, true).rankEditingEnabled).toBe(false);
    expect(buildBacklogOverviewViewModel(model, DEFAULT_BACKLOG_FILTERS, false).rankEditingEnabled).toBe(false);
  });
});
