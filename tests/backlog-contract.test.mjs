import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
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
    milestones: [],
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

test("backlog workspace is routed separately from planning and uses sprint commitments", async () => {
  const routes = await readFile("src/features/planning/model/workspace-routes.ts", "utf8");
  const page = await readFile("src/app/(workspaces)/backlog/page.tsx", "utf8");
  const loading = await readFile("src/app/(workspaces)/backlog/loading.tsx", "utf8");
  const model = await readFile("src/features/planning/model/planning-app-model.ts", "utf8");
  const renderer = await readFile("src/features/planning/organisms/planning-workspace-renderer.tsx", "utf8");
  const headerActions = await readFile("src/features/planning/hooks/use-planning-header-actions.ts", "utf8");

  assert.match(routes, /"backlog"/);
  assert.match(routes, /href: "\/backlog"/);
  assert.match(routes, /ListOrdered/);
  assert.match(page, /renderWorkspacePage\("backlog"\)/);
  assert.match(loading, /WorkspaceLoadingShell workspace="backlog" variant="backlog"/);
  await assert.rejects(() => readFile("src/lib/planning-data-scopes.ts", "utf8"), /ENOENT/);
  assert.match(renderer, /initialBacklogModel/);
  assert.match(model, /backlog: "Backlog"/);
  assert.match(renderer, /BacklogOverview/);
  assert.match(renderer, /BacklogWorkspacePanelLoading/);
  assert.match(renderer, /workspace === "backlog"/);
  assert.match(renderer, /onProposeDeliverable/);
  assert.match(renderer, /setTaskDialogDefaults\(\{ taskType: "deliverable" \}\)/);
  assert.doesNotMatch(headerActions, /workspace === "backlog"/);
  assert.doesNotMatch(headerActions, /Deliverable vorschlagen/);
});

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

test("backlog ordering API is operational-lead guarded and does not dirty github sync", async () => {
  const route = await readFile("src/app/api/tasks/backlog-order/route.ts", "utf8");
  const planningItems = await readFile("src/features/planning-items/model/planning-items-backlog-move.ts", "utf8");
  const apiClient = await readFile("src/features/tasks/model/task-api-client.ts", "utf8");
  const ordering = await readFile("src/features/backlog/hooks/use-backlog-ordering.ts", "utf8");
  const migration = await readSupabaseSchemaContract();

  assert.match(route, /requirePlanningContributor/);
  assert.match(route, /createBacklogMovePlanningItems/);
  assert.match(route, /\.run\(/);
  assert.doesNotMatch(route, /move_backlog_task_transaction|isOperationalLeadRole/);
  assert.match(planningItems, /backlogOrderRequiresOperationalLead/);
  assert.match(planningItems, /Nur CEO oder Deputy können die Backlog-Reihenfolge ändern/);
  assert.match(planningItems, /move_backlog_task_transaction/);
  assert.match(ordering, /expectedTaskUpdatedAt/);
  assert.match(ordering, /expectedTargetUpdatedAt/);
  assert.match(ordering, /updatedAt: persisted\.updatedAt/);
  assert.match(migration, /move_backlog_task_transaction/);
  assert.match(migration, /task\.backlog_reorder/);
  assert.match(migration, /v_task\.updated_at is distinct from p_expected_task_updated_at/);
  assert.doesNotMatch(`${route}\n${planningItems}`, /github_issue_sync_status|github_issue_sync_error|task_activity/);
  assert.match(apiClient, /moveBacklogTaskRequest/);
  assert.match(apiClient, /\/api\/tasks\/backlog-order/);
});

test("backlog UI uses custom FounderOps surfaces without native choice controls", async () => {
  const overview = await readFile("src/features/backlog/organisms/backlog-overview.tsx", "utf8");
  const planningTree = await readFile("src/features/backlog/molecules/planning-backlog-tree.tsx", "utf8");
  const rankTable = await readFile("src/features/backlog/molecules/backlog-rank-table.tsx", "utf8");
  const scopeTabs = await readFile("src/features/backlog/molecules/backlog-scope-tabs.tsx", "utf8");
  const sprintPane = await readFile("src/features/backlog/molecules/backlog-sprint-pane.tsx", "utf8");
  const sprintActions = await readFile("src/features/backlog/molecules/backlog-sprint-actions.tsx", "utf8");
  const taskActions = await readFile("src/features/backlog/molecules/backlog-task-actions.tsx", "utf8");
  const readiness = await readFile("src/features/backlog/molecules/backlog-readiness.tsx", "utf8");
  const skeleton = await readFile("src/features/backlog/organisms/backlog-content-skeleton.tsx", "utf8");
  const ordering = await readFile("src/features/backlog/hooks/use-backlog-ordering.ts", "utf8");
  const sprintAssignment = await readFile("src/features/backlog/hooks/use-backlog-sprint-assignment.ts", "utf8");
  const uiSurface = [overview, rankTable, scopeTabs, sprintPane, sprintActions, taskActions, readiness, skeleton].join("\n");

  assert.match(overview, /BacklogRankTable/);
  assert.match(overview, /BacklogSprintPane/);
  assert.match(rankTable, /DataTableFrame/);
  assert.match(rankTable, /filtering=\{\{ mode: "external", labelledBy: "backlog-data-filters" \}\}/);
  assert.match(rankTable, /surfaceVariant="structural"/);
  assert.match(rankTable, /mobileContent=/);
  assert.match(rankTable, /BacklogTaskActions/);
  assert.match(rankTable, /DataColumnHeader/);
  assert.match(rankTable, /ColumnFilterPopover/);
  assert.doesNotMatch(overview, /BacklogTypeFilter|typeOptions|filters\.type/);
  assert.doesNotMatch(rankTable, /BacklogTypeFilter|typeOptions|Backlog nach Typ/);
  assert.match(rankTable, /directionFor\("approval"\)/);
  assert.match(scopeTabs, /variant="structural"/);
  assert.match(taskActions, /CustomActionMenu/);
  assert.match(sprintActions, /BacklogSprintAssignmentMenu/);
  assert.match(sprintActions, /buildBacklogSprintActionGroup/);
  assert.match(planningTree, /BacklogSprintAssignmentMenu/);
  assert.match(taskActions, /triggerButtonProps/);
  assert.match(taskActions, /Ganz nach oben/);
  assert.match(sprintActions, /Aus Sprint entfernen/);
  assert.match(sprintActions, /BacklogBulkSprintAssignmentMenu/);
  assert.match(readiness, /backlogPlanningStateLabel/);
  assert.match(sprintPane, /getBacklogSprintAssignmentEligibility/);
  assert.match(sprintPane, /capacityUnavailable/);
  assert.match(sprintPane, /overCapacity/);
  assert.match(sprintPane, /formatDate/);
  assert.match(uiSurface, /overflow-x-auto/);
  assert.doesNotMatch(uiSurface, /overflow-x-scroll/);
  assert.match(overview, /data-tour-id="backlog-overview"/);
  assert.match(scopeTabs, /data-tour-id="backlog-scope-tabs"/);
  assert.match(rankTable, /data-tour-id="backlog-rank-table"/);
  assert.match(sprintPane, /data-tour-id="backlog-sprint-pane"/);
  assert.match(uiSurface, /onDrop/);
  assert.match(planningTree, /TaskChildProgress/);
  assert.match(planningTree, /const rollup = taskChildProgress\(rollupTasks\)/);
  assert.match(planningTree, /const rollupLabel = groupItemPluralLabel\(itemType\)/);
  assert.match(planningTree, /label=\{rollupLabel\}/);
  assert.match(planningTree, /visibleCount < rollup\.total/);
  assert.match(planningTree, /\{visibleCount\} von \{rollup\.total\} sichtbar/);
  assert.match(planningTree, /rankByTaskId/);
  assert.match(planningTree, />#\{rank\}</);
  assert.match(planningTree, /group\(groupId, "initiative", epic\.title, children, allChildren\)/);
  assert.match(planningTree, /group\(groupId, "deliverable", title, children, allChildren\)/);
  assert.match(planningTree, /draggable=\{isDraggable\}/);
  assert.match(planningTree, /event\.dataTransfer\.setData\("text\/plain", task\.id\)/);
  assert.match(overview, /onDragTaskStart=\{backlogLevel === "deliverable" && canManageBacklog \? setDraggedTaskId : undefined\}/);
  assert.match(overview, /canAssignSprints=\{backlogLevel === "deliverable" && canManageBacklog\}/);
  assert.match(rankTable, /canReorder/);
  assert.match(rankTable, /placement === "before"/);
  assert.match(overview, /sprints: \[\.\.\.model\.sprints\]/);
  assert.match(ordering, /moveBacklogTaskRequest/);
  assert.match(sprintAssignment, /getBacklogSprintAssignmentEligibility/);
  assert.match(sprintPane, /const sprintHorizon = 5/);
  assert.match(sprintPane, /Weitere \$\{hiddenSprintCount\} Sprints anzeigen/);
  assert.match(sprintPane, /showAllSprints \|\| draggedTask/);
  assert.match(rankTable, /SelectionCheckbox/);
  assert.match(rankTable, /BacklogBulkSprintAssignmentMenu/);
  assert.match(rankTable, /selectedTaskIds/);
  assert.doesNotMatch(sprintAssignment, /status:\s*"Offen"/);
  assert.doesNotMatch(uiSurface, /<select|<\/select|<option|type="date"|type="datetime-local"/);
});

test("planning board switches one canonical level at a time", async () => {
  const renderer = await readFile("src/features/planning/organisms/planning-task-view-renderer.tsx", "utf8");
  const filters = await readFile("src/features/planning/organisms/planning-filters.tsx", "utf8");
  const levelSelect = await readFile("src/features/planning/molecules/planning-level-select.tsx", "utf8");
  const viewState = await readFile("src/features/planning/hooks/use-planning-view-state.ts", "utf8");
  const board = await readFile("src/features/tasks/organisms/task-board-view.tsx", "utf8");
  const structure = await readFile("src/features/tasks/organisms/task-structure-view.tsx", "utf8");
  const card = await readFile("src/features/tasks/molecules/task-card.tsx", "utf8");
  const headerActions = await readFile("src/features/planning/hooks/use-planning-header-actions.ts", "utf8");

  assert.match(levelSelect, /PlanningLevelSelect/);
  assert.match(levelSelect, /CustomSelect/);
  assert.match(levelSelect, /Ebene/);
  assert.match(viewState, /planningLevel/);
  assert.match(viewState, /planningParentFilterId/);
  assert.match(viewState, /namespace: "board"/);
  assert.match(viewState, /level: enumUrlField\("deliverable", \["epic", "initiative", "deliverable"\] as const\)/);
  assert.match(viewState, /updatePlanningBoardUrlState\(\{ level, parentId: "all" \}\)/);
  assert.match(viewState, /hasPlanningBoardUrlState/);
  assert.match(renderer, /strategicPlanningStatuses/);
  assert.match(renderer, /const boardStatuses = planningLevel === "deliverable" \? taskStatuses : strategicPlanningStatuses/);
  assert.match(renderer, /const boardTasks = useMemo/);
  assert.match(renderer, /return visibleTasks\.filter/);
  assert.match(filters, /Parent-Epic/);
  assert.match(filters, /Parent-Initiative/);
  assert.match(filters, /leadingControls=/);
  assert.match(filters, /contextControls=/);
  assert.match(renderer, /planningBoardTasks = visibleTasks\.filter\(\(task\) => task\.taskType === "deliverable" && isTaskPlanningActive\(task\)\)/);
  assert.match(renderer, /isTaskPlanningActive/);
  assert.match(renderer, /statuses=\{boardStatuses\}/);
  assert.match(renderer, /itemType=\{planningLevel\}/);
  assert.match(renderer, /visibleTasks=\{boardTasks\}/);
  assert.match(renderer, /onChangeTaskStatus=/);
  assert.match(renderer, /task\.taskType !== "epic" && task\.taskType !== "initiative"/);
  assert.match(renderer, /return strategicPlanningStatuses/);
  assert.match(renderer, /strategicPlanningStatuses\.filter\(\(status\) => status !== "Erledigt"\)/);
  assert.match(renderer, /ausschließlich Deliverables/);
  assert.match(board, /itemType: Task\["taskType"\]/);
  assert.match(board, /task\.taskType === itemType/);
  assert.match(board, /directChildrenByParent/);
  assert.match(board, /groupDirectChildrenByParent/);
  assert.match(board, /statusOptionsForTask/);
  assert.match(renderer, /showParentContext=\{parentFilterId === "all" && planningLevel !== "epic"\}/);
  assert.match(board, /showParentContext=\{showParentContext\}/);
  assert.match(board, /const completedCardLimit = 20/);
  assert.match(board, /status === "Erledigt"/);
  assert.match(board, /Date\.parse\(right\.updatedAt/);
  assert.match(board, /Weitere \$\{hiddenCompletedCount\} erledigte anzeigen/);
  assert.match(card, /TaskCardStatusMenu/);
  assert.match(card, /Status für \$\{taskTitle\} ändern/);
  assert.match(card, /triggerLabel=\{currentStatus\}/);
  assert.match(card, /border-t border-slate-100 pt-2\.5[\s\S]*>Status<\/span>/);
  assert.match(card, /data-task-card-interactive="true"/);
  assert.match(card, /isTaskCardControlClick\(event\)/);
  assert.match(card, /draggedRef\.current/);
  assert.match(card, /1 Kind noch offen/);
  assert.match(card, /Kinder noch offen/);
  assert.match(card, /Ohne \$\{directParentType\}/);
  assert.match(headerActions, /view === "board" \? planningLevel : "deliverable"/);
  assert.match(structure, /groupSubIssuesByParent/);
  assert.match(structure, /subIssues=\{subIssuesByParent\.get\(task\.id\) \|\| \[\]\}/);
  assert.doesNotMatch([board, structure, card].join("\n"), /variant="board"|variant\?: "default" \| "board"/);
  assert.doesNotMatch(board, /taskType: status === "Vorschlag" \? "proposal" : "deliverable"/);
});
