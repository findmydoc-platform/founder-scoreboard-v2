import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const statusMock = {
  normalizeStatus: (status) => status,
};

const scheduleMock = {
  findCurrentSprint: (sprints) => sprints.find((sprint) => sprint.status === "active") || sprints[0],
};

function basePlanningData() {
  return {
    project: { id: "findmydoc-founder-execution", name: "findmydoc Planning", range: "" },
    profiles: [
      { id: "ceo", name: "CEO", weeklyCapacity: 20 },
      { id: "deputy", name: "Deputy", weeklyCapacity: 22 },
    ],
    packages: [
      { id: "initiative-1", title: "Ärzte gewinnen", goal: "", priority: "P1", sortOrder: 10 },
    ],
    milestones: [],
    tasks: [
      {
        id: "late-p0",
        order: 30,
        title: "P0 später im Backlog",
        description: "",
        status: "Offen",
        priority: "P0",
        assignee: "CEO",
        owner: "CEO",
        packageId: "initiative-1",
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
        status: "Vorschlag",
        priority: "P2",
        assignee: "Deputy",
        owner: "Deputy",
        packageId: "initiative-1",
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
        packageId: "initiative-1",
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
        packageId: "initiative-1",
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
    sprintCommitments: [
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

test("backlog workspace is routed separately from planning and uses sprint commitments", async () => {
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const page = await readFile("src/app/(workspaces)/backlog/page.tsx", "utf8");
  const dataScopes = await readFile("src/lib/planning-data-scopes.ts", "utf8");
  const loading = await readFile("src/app/(workspaces)/backlog/loading.tsx", "utf8");
  const model = await readFile("src/features/planning/model/planning-app-model.ts", "utf8");
  const renderer = await readFile("src/features/planning/organisms/planning-workspace-renderer.tsx", "utf8");
  const headerAction = await readFile("src/features/planning/hooks/use-planning-header-primary-action.ts", "utf8");

  assert.match(routes, /"backlog"/);
  assert.match(routes, /href: "\/backlog"/);
  assert.match(routes, /ListOrdered/);
  assert.match(page, /renderWorkspacePage\("backlog"\)/);
  assert.match(loading, /WorkspaceLoadingShell workspace="backlog" variant="backlog"/);
  assert.match(dataScopes, /backlog: \{[\s\S]*sprintCommitments: true,[\s\S]*\}/);
  assert.match(model, /backlog: "Backlog"/);
  assert.match(renderer, /BacklogOverview/);
  assert.match(renderer, /BacklogWorkspacePanelLoading/);
  assert.match(renderer, /workspace === "backlog"/);
  assert.match(headerAction, /workspace === "backlog"/);
  assert.match(headerAction, /Deliverable vorschlagen/);
  assert.match(headerAction, /taskType: "deliverable"/);
});

test("backlog view model sorts by rank not priority and keeps sprint as assignment", async () => {
  const { buildBacklogTableViewModel, buildBacklogViewModel, DEFAULT_BACKLOG_FILTERS, filterBacklogItemsByQuery } = await loadTranspiledModule("src/features/backlog/model/backlog-view-model.ts", {
    "@/lib/planning-schedule": scheduleMock,
    "@/lib/status": statusMock,
    "@/features/planning/model/approval-domain": {
      isApprovedDeliverable: (task) => task.taskType === "deliverable" && task.approvalStatus === "approved",
      isProposedDeliverable: (task) => task.taskType === "deliverable" && task.approvalStatus === "proposed",
    },
  });
  const { backlogTableColumns, backlogTableColumnCount, backlogTableMinWidth } = await loadTranspiledModule("src/features/backlog/model/backlog-table-layout.ts");

  const all = buildBacklogViewModel(basePlanningData(), "all");
  const ready = buildBacklogViewModel(basePlanningData(), "ready");
  const proposals = buildBacklogViewModel(basePlanningData(), "proposals");
  const queried = filterBacklogItemsByQuery(all.visibleItems, "später");
  const combined = buildBacklogTableViewModel(basePlanningData(), {
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
  assert.equal(all.sprintBuckets[0].capacityHours, 42);
  assert.equal(backlogTableColumns.length, 9);
  assert.equal(backlogTableColumnCount, 9);
  assert.equal(backlogTableMinWidth, 900);
});

test("backlog ordering API is operational-lead guarded and does not dirty github sync", async () => {
  const route = await readFile("src/app/api/tasks/backlog-order/route.ts", "utf8");
  const apiClient = await readFile("src/features/tasks/model/task-api-client.ts", "utf8");
  const ordering = await readFile("src/features/backlog/hooks/use-backlog-ordering.ts", "utf8");
  const migration = await readFile("supabase/0048_transactional_planning_batches.sql", "utf8");

  assert.match(route, /requirePlanningContributor/);
  assert.match(route, /isOperationalLeadRole/);
  assert.match(route, /Nur CEO oder Deputy können die Backlog-Reihenfolge ändern/);
  assert.match(route, /update_backlog_order_transaction/);
  assert.match(ordering, /expectedUpdatedAt/);
  assert.match(ordering, /updatedAt: persisted\.updatedAt/);
  assert.match(migration, /sort_order = requested\."sortOrder"/);
  assert.match(migration, /task\.backlog_reorder/);
  assert.match(migration, /task\.updated_at <> requested\."expectedUpdatedAt"/);
  assert.doesNotMatch(route, /github_issue_sync_status|github_issue_sync_error|task_activity/);
  assert.match(apiClient, /updateBacklogOrderRequest/);
  assert.match(apiClient, /\/api\/tasks\/backlog-order/);
});

test("backlog UI uses custom FounderOps surfaces without native choice controls", async () => {
  const overview = await readFile("src/features/backlog/organisms/backlog-overview.tsx", "utf8");
  const rankTable = await readFile("src/features/backlog/molecules/backlog-rank-table.tsx", "utf8");
  const scopeTabs = await readFile("src/features/backlog/molecules/backlog-scope-tabs.tsx", "utf8");
  const sprintPane = await readFile("src/features/backlog/molecules/backlog-sprint-pane.tsx", "utf8");
  const skeleton = await readFile("src/features/backlog/organisms/backlog-content-skeleton.tsx", "utf8");
  const ordering = await readFile("src/features/backlog/hooks/use-backlog-ordering.ts", "utf8");
  const sprintAssignment = await readFile("src/features/backlog/hooks/use-backlog-sprint-assignment.ts", "utf8");
  const uiSurface = [overview, rankTable, scopeTabs, sprintPane, skeleton].join("\n");

  assert.match(overview, /BacklogRankTable/);
  assert.match(overview, /BacklogSprintPane/);
  assert.match(rankTable, /DataTableFrame/);
  assert.match(rankTable, /filtering=\{\{ mode: "embedded", toolbar \}\}/);
  assert.match(rankTable, /DataColumnHeader/);
  assert.match(rankTable, /ColumnFilterPopover/);
  assert.match(uiSurface, /overflow-x-scroll/);
  assert.match(overview, /data-tour-id="backlog-overview"/);
  assert.match(scopeTabs, /data-tour-id="backlog-scope-tabs"/);
  assert.match(rankTable, /data-tour-id="backlog-rank-table"/);
  assert.match(sprintPane, /data-tour-id="backlog-sprint-pane"/);
  assert.match(uiSurface, /onDrop/);
  assert.match(rankTable, /title="Backlog-Rang per Drag oder Alt\+Pfeiltasten ändern"/);
  assert.match(ordering, /updateBacklogOrderRequest/);
  assert.match(sprintAssignment, /status: "Offen"/);
  assert.match(sprintAssignment, /Für die Sprint-Zuordnung fehlen Zuständigkeit oder Initiative/);
  assert.doesNotMatch(uiSurface, /<select|<\/select|<option|type="date"|type="datetime-local"/);
});

test("planning board keeps non-approved items out of the board columns", async () => {
  const renderer = await readFile("src/features/planning/organisms/planning-task-view-renderer.tsx", "utf8");
  const board = await readFile("src/features/tasks/organisms/task-board-view.tsx", "utf8");

  assert.match(renderer, /planningBoardStatuses = taskStatuses\.filter\(\(status\) => status !== "Vorschlag"\)/);
  assert.match(renderer, /planningBoardTasks = visibleTasks/);
  assert.match(renderer, /isTaskPlanningActive/);
  assert.match(renderer, /normalizeStatus\(task\.status\) !== "Vorschlag"/);
  assert.match(renderer, /statuses=\{planningBoardStatuses\}/);
  assert.match(renderer, /visibleTasks=\{planningBoardTasks\}/);
  assert.match(board, /taskType: "deliverable"/);
  assert.doesNotMatch(board, /taskType: status === "Vorschlag" \? "proposal" : "deliverable"/);
});
