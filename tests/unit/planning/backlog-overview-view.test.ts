import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKLOG_FILTERS,
  buildBacklogOverviewViewModel,
  buildSelectedBacklogOverviewViewModel,
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

const receipt = { sourceRevision: "revision-1", scopeRevision: "scope-1", observedAt: "2026-11-18T09:00:00Z", validUntil: "2026-11-19T00:00:00Z" };
const deliverableSelection: NonNullable<BacklogModel["selection"]> = {
  ...receipt,
  query: { view: "backlog", filters: DEFAULT_BACKLOG_FILTERS, limit: 20 },
  itemIds: ["deliverable-1"],
  contextIds: ["initiative-1", "epic-1"],
  rankById: { "deliverable-1": 7 },
  total: 1,
  coverage: "complete",
  continuation: null,
};

describe("backlog overview view", () => {
  it("uses the independent sprint receipt to display buckets in the selected backlog", () => {
    const bucket = {
      sprint: { id: "sprint-1", name: "Winter", status: "active" as const, startDate: "2026-11-16", endDate: "2026-11-29", reviewDueAt: "", scoreLocked: false },
      capacityHours: 40,
      capacityUnavailable: false,
      isCurrent: true,
      locked: false,
      overCapacity: false,
      overCapacityHours: 0,
      plannedHours: 12,
      utilization: 0.3,
    };
    const selected: BacklogModel = {
      ...model,
      selection: deliverableSelection,
      sprintBasis: { ...receipt, coverage: "complete", day: "2026-11-18", buckets: [bucket] },
      get sprints(): never { throw new Error("The selected backlog has no legacy sprint collection"); },
    };

    const view = buildSelectedBacklogOverviewViewModel(selected, DEFAULT_BACKLOG_FILTERS, true);

    expect(view.sprintBuckets).toEqual([bucket]);
    expect(view.visibleItems.map(({ task, initiative, rank }) => [task.id, initiative?.id, rank])).toEqual([["deliverable-1", "initiative-1", 7]]);
    expect(view.rankEditingEnabled).toBe(true);
  });

  it("displays server-matched rows in their selected order, with exact independent controls", () => {
    const filters = {
      ...DEFAULT_BACKLOG_FILTERS,
      query: "  IN STORED DESCRIPTIONS  ",
      status: "Offen",
      initiative: "initiative-1",
      assignee: owner.id,
      sort: "title" as const,
    };
    const scopedModel: BacklogModel = {
      ...model,
      items: [...model.items, task({ id: "deliverable-2", title: "Earlier title", order: 3, parentTaskId: "initiative-1" })],
      selection: {
        ...deliverableSelection,
        query: { ...deliverableSelection.query, limit: 2, filters: { ...filters, query: "in stored descriptions" } },
        itemIds: ["deliverable-2", "deliverable-1"],
        rankById: { "deliverable-1": 7, "deliverable-2": 11 },
        total: 38,
        coverage: "partial",
        continuation: "next-page",
      },
      controls: {
        ...receipt,
        coverage: "complete",
        levelTotals: { epic: 2, initiative: 5, deliverable: 40 },
        scopeCounts: { all: 40, proposals: 2, ready: 32, unscheduled: 33 },
        statuses: { epic: [], initiative: [], deliverable: ["Offen", "In Arbeit"] },
        assignees: [{ value: owner.id, label: "Authoritative name" }],
        epics: [],
        initiatives: [],
      },
    };
    const view = buildSelectedBacklogOverviewViewModel(scopedModel, filters, true);

    expect(view.selectionCurrent).toBe(true);
    expect(view.visibleItems.map(({ task, rank }) => [task.id, rank])).toEqual([["deliverable-2", 11], ["deliverable-1", 7]]);
    expect(view.orderedTasks.map(({ id }) => id)).toEqual(["deliverable-1", "deliverable-2"]);
    expect(view.scopeCounts).toEqual({ all: 40, proposals: 2, ready: 32, unscheduled: 33 });
    expect(view.activeFilters.map(({ label }) => label)).toEqual(["Status: Offen", "Initiative: Nicht verfügbar", "Zuständig: Authoritative name"]);
    expect(view.filterOptions.statuses.map(({ value }) => value)).toEqual(["Alle", "Offen", "In Arbeit"]);
    expect(view.filterStateIsDirty).toBe(true);
    expect(view.rankEditingEnabled).toBe(false);
  });

  it("distinguishes waiting for a query from a confirmed empty result", () => {
    const filters = { ...DEFAULT_BACKLOG_FILTERS, initiative: "initiative-1" };
    const waiting = buildSelectedBacklogOverviewViewModel({ ...model, selection: deliverableSelection }, filters, true);
    const empty = buildSelectedBacklogOverviewViewModel({
      ...model,
      selection: {
        ...deliverableSelection,
        query: { ...deliverableSelection.query, filters },
        itemIds: [],
        contextIds: [],
        rankById: {},
        total: 0,
      },
    }, filters, true);

    expect(waiting.selectionCurrent).toBe(false);
    expect(waiting.visibleLevelTasks.map(({ id }) => id)).toEqual(["deliverable-1"]);
    expect(waiting.activeFilters.map(({ label }) => label)).toEqual(["Initiative: Kontext wird geladen"]);
    expect(waiting.scopeCounts).toBeUndefined();
    expect(empty.selectionCurrent).toBe(true);
    expect(empty.visibleLevelTasks).toEqual([]);
  });

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
