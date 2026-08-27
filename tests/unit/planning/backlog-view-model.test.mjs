import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const statusMock = {
  normalizeStatus: (status) => status,
};

const scheduleMock = {
  findCurrentSprint: (sprints) => sprints.find((sprint) => sprint.status === "active") || sprints[0],
};

function basePlanningShellState() {
  return {
    project: { id: "findmydoc-founder-execution", name: "findmydoc Planning", range: "" },
    people: [
      { id: "ceo", name: "CEO", weeklyCapacity: 20 },
      { id: "deputy", name: "Deputy", weeklyCapacity: 22 },
    ],
    packages: [
      { id: "initiative-1", title: "Ärzte gewinnen", goal: "", priority: "P1", sortOrder: 10 },
    ],
    items: [
      {
        id: "initiative-1",
        order: 1,
        title: "Ärzte gewinnen",
        description: "",
        status: "Geplant",
        priority: "P1",
        assignee: "CEO",
        owner: "CEO",
        parentTaskId: "initiative-1",
        taskType: "initiative",
        approvalStatus: "approved",
        sprintId: "",
        hours: 0,
      },
      {
        id: "late-p0",
        order: 30,
        title: "P0 später im Backlog",
        description: "",
        status: "Offen",
        priority: "P0",
        assignee: "CEO",
        owner: "CEO",
        parentTaskId: "initiative-1",
        taskType: "deliverable",
        approvalStatus: "approved",
        sprintId: "",
        hours: 8,
      },
      {
        id: "first-p2",
        order: 10,
        title: "P2 erster Rang",
        description: "",
        status: "Offen",
        priority: "P2",
        assignee: "Deputy",
        owner: "Deputy",
        parentTaskId: "initiative-1",
        taskType: "deliverable",
        approvalStatus: "proposed",
        sprintId: "",
        hours: 5,
      },
      {
        id: "planned",
        order: 20,
        title: "Geplant",
        description: "",
        status: "Offen",
        priority: "P1",
        assignee: "CEO",
        owner: "CEO",
        parentTaskId: "initiative-1",
        taskType: "deliverable",
        approvalStatus: "approved",
        sprintId: "sprint-4",
        hours: 13,
      },
      {
        id: "sub",
        order: 1,
        title: "Sub-Issue",
        description: "",
        status: "Offen",
        priority: "P0",
        assignee: "CEO",
        owner: "CEO",
        parentTaskId: "initiative-1",
        taskType: "sub_issue",
        approvalStatus: null,
        sprintId: "",
        hours: 1,
      },
    ],
    sprints: [
      { id: "sprint-4", name: "Sprint 4", status: "active", startDate: "2026-07-06", endDate: "2026-07-19", reviewDueAt: "2026-07-17T12:00", scoreLocked: false },
      { id: "sprint-5", name: "Sprint 5", status: "planning", startDate: "2026-07-20", endDate: "2026-08-02", reviewDueAt: "2026-07-31T12:00", scoreLocked: false },
    ],
    commitments: [
      { id: 1, sprintId: "sprint-4", profileId: "ceo", commitmentLevel: "Standard", weeklyHours: 20, note: "" },
      { id: 2, sprintId: "sprint-4", profileId: "deputy", commitmentLevel: "Standard", weeklyHours: 22, note: "" },
    ],
    founderSprintScores: [],
    founderStrikeStates: [],
    strikeEvents: [],
    scoreObjections: [],
    taskComments: [],
    taskExternalComments: [],
    taskBlockers: [],
    taskRelations: [],
    taskActivity: [],
    taskFocusItems: [],
    notificationEvents: [],
    notificationDeliveries: [],
    notificationPreferences: [],
    profileUiPreferences: [],
    profileFeatureTourAcknowledgements: [],
    fmdTools: [],
    events: [],
    meetings: [],
    meetingAttendance: [],
    audit: [],
  };
}

test("backlog view model sorts by rank not priority and keeps sprint as assignment", async () => {
  const planningState = await loadTranspiledModule("src/features/backlog/model/backlog-planning-state.ts", {
    "@/lib/status": statusMock,
  });
  const { buildBacklogTableViewModel, buildBacklogViewModel, DEFAULT_BACKLOG_FILTERS, filterBacklogItemsByQuery } = await loadTranspiledModule("src/features/backlog/model/backlog-view-model.ts", {
    "@/features/backlog/model/backlog-planning-state": planningState,
    "@/lib/planning-schedule": scheduleMock,
    "@/lib/status": statusMock,
    "@/features/planning/model/approval-domain": {
      isApprovedDeliverable: (task) => task.taskType === "deliverable" && task.approvalStatus === "approved",
      isProposedDeliverable: (task) => task.taskType === "deliverable" && task.approvalStatus === "proposed",
    },
  });
  const { backlogTableColumns, backlogTableColumnCount, backlogTableMinWidth } = await loadTranspiledModule("src/features/backlog/model/backlog-table-layout.ts");

  const all = buildBacklogViewModel(basePlanningShellState(), "all");
  const ready = buildBacklogViewModel(basePlanningShellState(), "ready");
  const proposals = buildBacklogViewModel(basePlanningShellState(), "proposals");
  const queried = filterBacklogItemsByQuery(all.visibleItems, "später");
  const combined = buildBacklogTableViewModel(basePlanningShellState(), {
    ...DEFAULT_BACKLOG_FILTERS,
    priority: "P0",
    assignee: "CEO",
  });

  assert.deepEqual(all.visibleItems.map((item) => item.task.id), ["first-p2", "planned", "late-p0"]);
  assert.deepEqual(proposals.visibleItems.map((item) => item.task.id), ["first-p2"]);
  assert.deepEqual(ready.visibleItems.map((item) => item.task.id), ["late-p0"]);
  assert.deepEqual(queried.map((item) => item.task.id), ["late-p0"]);
  assert.deepEqual(combined.visibleItems.map((item) => item.task.id), ["late-p0"]);
  assert.equal(all.sprintBuckets[0].sprint.id, "sprint-4");
  assert.equal(all.sprintBuckets[0].plannedHours, 13);
  assert.equal(all.sprintBuckets[0].capacityHours, 84);
  assert.equal(backlogTableColumns.length, 9);
  assert.equal(backlogTableColumnCount, 9);
  assert.equal(backlogTableMinWidth, 960);
});
