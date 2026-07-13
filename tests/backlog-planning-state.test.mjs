import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const statusMock = {
  normalizeStatus: (status) => status,
};

const approvalMock = {
  isApprovedDeliverable: (task) => task.taskType === "deliverable" && task.approvalStatus === "approved",
  isProposedDeliverable: (task) => task.taskType === "deliverable" && task.approvalStatus === "proposed",
};

const scheduleMock = {
  findCurrentSprint: (sprints) => sprints.find((sprint) => sprint.status === "active") || sprints[0],
};

function planningTask(overrides = {}) {
  return {
    taskType: "deliverable",
    approvalStatus: "approved",
    status: "Offen",
    assigneeId: "ceo",
    ownerId: "ceo",
    packageId: "initiative-1",
    hasInitiative: true,
    sprintId: "",
    ...overrides,
  };
}

async function loadPlanningState() {
  return loadTranspiledModule("src/features/backlog/model/backlog-planning-state.ts", {
    "@/lib/status": statusMock,
  });
}

function planningData() {
  return {
    profiles: [{ id: "ceo", name: "CEO", weeklyCapacity: 42 }],
    packages: [{ id: "initiative-1", title: "Wachstum" }],
    tasks: [
      {
        id: "ready",
        order: 10,
        title: "Bereite Aufgabe",
        description: "",
        status: "Offen",
        priority: "P1",
        assigneeId: "ceo",
        assignee: "CEO",
        ownerId: "ceo",
        owner: "CEO",
        packageId: "initiative-1",
        taskType: "deliverable",
        approvalStatus: "approved",
        sprintId: "",
        hours: 4,
      },
      {
        id: "planned",
        order: 20,
        title: "Eingeplante Aufgabe",
        description: "",
        status: "Offen",
        priority: "P1",
        assigneeId: "ceo",
        assignee: "CEO",
        ownerId: "ceo",
        owner: "CEO",
        packageId: "initiative-1",
        taskType: "deliverable",
        approvalStatus: "approved",
        sprintId: "sprint-14",
        hours: 100,
      },
      {
        id: "blocked",
        order: 30,
        title: "Freigabe fehlt",
        description: "",
        status: "Offen",
        priority: "P1",
        assigneeId: "ceo",
        assignee: "CEO",
        ownerId: "ceo",
        owner: "CEO",
        packageId: "initiative-1",
        taskType: "deliverable",
        approvalStatus: "proposed",
        sprintId: "",
        hours: 4,
      },
    ],
    sprints: [
      { id: "sprint-14", name: "Sprint 14", status: "active", startDate: "2026-07-06", endDate: "2026-07-19", reviewDueAt: "", scoreLocked: false },
      { id: "invalid", name: "Ungültig", status: "planning", startDate: "2026-07-32", endDate: "2026-08-02", reviewDueAt: "", scoreLocked: false },
    ],
    sprintCommitments: [{ id: 1, sprintId: "sprint-14", profileId: "ceo", commitmentLevel: "Standard", weeklyHours: 42, note: "" }],
  };
}

test("planning state separates ready, scheduled, blocked, completed, and unsupported tasks", async () => {
  const { getBacklogPlanningState } = await loadPlanningState();

  assert.deepEqual(getBacklogPlanningState(planningTask()), { kind: "ready", blockingReasons: [] });
  assert.deepEqual(getBacklogPlanningState(planningTask({ sprintId: "sprint-1" })), { kind: "scheduled", blockingReasons: [] });
  assert.deepEqual(getBacklogPlanningState(planningTask({ approvalStatus: "proposed" })), { kind: "blocked", blockingReasons: ["approval"] });
  assert.deepEqual(getBacklogPlanningState(planningTask({ assigneeId: "", ownerId: "" })), { kind: "blocked", blockingReasons: ["owner"] });
  assert.deepEqual(getBacklogPlanningState(planningTask({ hasInitiative: false })), { kind: "blocked", blockingReasons: ["initiative"] });
  assert.deepEqual(getBacklogPlanningState(planningTask({ status: "Erledigt" })), { kind: "completed", blockingReasons: [] });
  assert.deepEqual(getBacklogPlanningState(planningTask({ taskType: "sub_issue" })), { kind: "unsupported", blockingReasons: [] });
});

test("sprint eligibility preserves approval, source-lock, target-lock, reassignment, and removal contracts", async () => {
  const { getBacklogSprintAssignmentEligibility } = await loadPlanningState();
  const target = { id: "sprint-next", scoreLocked: false };

  assert.deepEqual(
    getBacklogSprintAssignmentEligibility(planningTask(), target, { canManage: true }),
    { ok: true, action: "assign", planningState: { kind: "ready", blockingReasons: [] } },
  );
  assert.equal(getBacklogSprintAssignmentEligibility(planningTask({ approvalStatus: "proposed" }), target).reason, "approval");
  assert.equal(getBacklogSprintAssignmentEligibility(planningTask(), target, { canManage: false }).reason, "permission");
  assert.equal(getBacklogSprintAssignmentEligibility(planningTask(), { ...target, scoreLocked: true }).reason, "target_locked");

  const scheduled = planningTask({ sprintId: "sprint-current" });
  assert.equal(getBacklogSprintAssignmentEligibility(scheduled, target).action, "reassign");
  assert.equal(getBacklogSprintAssignmentEligibility(scheduled, target, { sourceSprintLocked: true }).reason, "source_locked");
  assert.equal(getBacklogSprintAssignmentEligibility(scheduled, { id: "sprint-current", scoreLocked: true }).reason, "already_assigned");
  assert.equal(getBacklogSprintAssignmentEligibility(scheduled, null).action, "unassign");
  assert.equal(getBacklogSprintAssignmentEligibility(scheduled, null, { sourceSprintLocked: true }).reason, "source_locked");
});

test("backlog view model reports explicit readiness and sprint capacity over the full sprint duration", async () => {
  const planningState = await loadPlanningState();
  const { buildBacklogTableViewModel, buildBacklogViewModel, DEFAULT_BACKLOG_FILTERS } = await loadTranspiledModule("src/features/backlog/model/backlog-view-model.ts", {
    "@/features/backlog/model/backlog-planning-state": planningState,
    "@/features/planning/model/approval-domain": approvalMock,
    "@/lib/planning-schedule": scheduleMock,
    "@/lib/status": statusMock,
  });
  const data = planningData();
  const all = buildBacklogViewModel(data, "all");
  const incomplete = buildBacklogTableViewModel(data, { ...DEFAULT_BACKLOG_FILTERS, readiness: "incomplete" });
  const bucket = all.sprintBuckets.find((item) => item.sprint.id === "sprint-14");
  const invalidBucket = all.sprintBuckets.find((item) => item.sprint.id === "invalid");

  assert.equal(all.allItems.find((item) => item.task.id === "ready").planningState.kind, "ready");
  assert.equal(all.allItems.find((item) => item.task.id === "planned").planningState.kind, "scheduled");
  assert.deepEqual(incomplete.visibleItems.map((item) => item.task.id), ["blocked"]);
  assert.equal(bucket.capacityHours, 84);
  assert.equal(bucket.overCapacity, true);
  assert.equal(bucket.overCapacityHours, 16);
  assert.equal(bucket.utilization, 100 / 84);
  assert.equal(invalidBucket.capacityHours, null);
  assert.equal(invalidBucket.capacityUnavailable, true);
});

test("task update and API route use the shared sprint assignment contract without changing task status", async () => {
  const [route, command, sprintAssignment] = await Promise.all([
    readFile("src/app/api/tasks/[id]/route.ts", "utf8"),
    readFile("src/features/tasks/hooks/use-task-update-command.ts", "utf8"),
    readFile("src/features/backlog/hooks/use-backlog-sprint-assignment.ts", "utf8"),
  ]);

  assert.match(route, /getBacklogSprintAssignmentEligibility/);
  assert.match(route, /backlogSprintAssignmentMessage/);
  assert.match(route, /sourceSprintLocked/);
  assert.match(route, /sprintAssignmentNoop/);
  assert.match(route, /ACTIVE_PACKAGES_TABLE/);
  assert.match(command, /TaskUpdateResult/);
  assert.match(command, /return queuedMutation/);
  assert.match(sprintAssignment, /getBacklogSprintAssignmentEligibility/);
  assert.match(sprintAssignment, /sprint\?\.id \|\| ""/);
  assert.doesNotMatch(sprintAssignment, /status:\s*"Offen"/);
});
