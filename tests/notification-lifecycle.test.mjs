import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const catalog = await loadTranspiledModule("src/lib/notification-catalog.ts");
const platform = {
  isOperationalLeadRole: (role) => role === "ceo" || role === "deputy",
};
const status = {
  normalizeStatus: (value) => value || "Offen",
};
const resolution = await loadTranspiledModule("src/lib/notification-resolution.ts", {
  "./notification-catalog": catalog,
  "./platform": platform,
  "./status": status,
});
const lifecycle = await loadTranspiledModule("src/lib/notification-lifecycle.ts", {
  "./platform": platform,
});

const now = new Date("2026-07-11T10:00:00.000Z");
const baseTask = {
  id: "task-1",
  status: "Review",
  assignee: "founder-1",
  owner: "founder-1",
  reviewOwnerProfileId: "reviewer-1",
  reviewStatus: "requested",
  scoreFinal: false,
  taskType: "deliverable",
  endDate: "2026-07-10",
  deadline: "",
};
const baseEvent = {
  id: 7,
  status: "planned",
  startsAt: "2026-07-15T10:00:00.000Z",
  audienceMode: "selected",
  participantProfileIds: ["founder-1"],
  reminderDaysBefore: 7,
};
const baseNotification = {
  id: 1,
  type: "task.review_requested",
  actorProfileId: "ceo-1",
  recipientProfileId: "reviewer-1",
  entityType: "task",
  entityId: "task-1",
  title: "Review",
  body: "",
  status: "pending",
  seenAt: "",
  dismissedAt: "",
  resolvedAt: "",
  resolutionReason: "",
  createdAt: "2026-07-11T09:00:00.000Z",
};

function context(patch = {}) {
  return {
    tasks: new Map([[baseTask.id, baseTask]]),
    blockers: new Map([[baseTask.id, [{ id: 1, taskId: baseTask.id, status: "open" }]]]),
    sprints: new Map([["sprint-1", { id: "sprint-1", status: "review", scoreLocked: false, reviewDueAt: "2026-07-11" }]]),
    events: new Map([["7", baseEvent]]),
    meetings: new Set(["9"]),
    profileRoles: new Map([
      ["ceo-1", "ceo"],
      ["deputy-1", "deputy"],
      ["founder-1", "founder"],
      ["reviewer-1", "founder"],
    ]),
    ...patch,
  };
}

test("notification catalog centralizes lifecycle display and delivery rules", () => {
  assert.equal(catalog.notificationDefinition("task.review_requested").lifecycle, "actionable");
  assert.equal(catalog.notificationDefinition("task.review_reopened").lifecycle, "informational");
  assert.equal(catalog.notificationTypeLabel("task.blocker_reported"), "Blocker");
  assert.equal(catalog.shouldSendToGoogleChatDm("task.comment"), false);
  assert.equal(catalog.shouldSendToGoogleChatDigest("event.upcoming"), true);
});

test("review and assignee changes resolve actionable notifications", () => {
  assert.equal(resolution.notificationResolution(baseNotification, context(), now), null);
  assert.equal(
    resolution.notificationResolution(baseNotification, context({ tasks: new Map([[baseTask.id, { ...baseTask, reviewStatus: "accepted" }]]) }), now).reason,
    "review_completed",
  );
  assert.equal(
    resolution.notificationResolution(baseNotification, context({ tasks: new Map([[baseTask.id, { ...baseTask, reviewOwnerProfileId: "other" }]]) }), now).reason,
    "recipient_changed",
  );

  const rework = { ...baseNotification, type: "task.review_rework", recipientProfileId: "founder-1" };
  assert.equal(
    resolution.notificationResolution(rework, context({ tasks: new Map([[baseTask.id, { ...baseTask, reviewStatus: "changes_requested", status: "Nacharbeit" }]]) }), now),
    null,
  );
  assert.equal(
    resolution.notificationResolution(rework, context({ tasks: new Map([[baseTask.id, { ...baseTask, assignee: "other", owner: "other", reviewStatus: "changes_requested", status: "Nacharbeit" }]]) }), now).reason,
    "recipient_changed",
  );
});

test("deadlines blockers sprints events and deleted targets reconcile by source truth", () => {
  const deadline = { ...baseNotification, type: "task.deadline_overdue", recipientProfileId: "founder-1" };
  assert.equal(resolution.notificationResolution(deadline, context(), now), null);
  assert.equal(
    resolution.notificationResolution(deadline, context({ tasks: new Map([[baseTask.id, { ...baseTask, endDate: "2026-07-20" }]]) }), now).reason,
    "deadline_changed",
  );

  const blocker = { ...baseNotification, type: "task.blocker_reported", recipientProfileId: "ceo-1" };
  assert.equal(resolution.notificationResolution(blocker, context(), now), null);
  assert.equal(resolution.notificationResolution(blocker, context({ blockers: new Map([[baseTask.id, []]]) }), now).reason, "blocker_resolved");

  const sprint = { ...baseNotification, type: "sprint.review_due", recipientProfileId: "", entityType: "sprint", entityId: "sprint-1" };
  assert.equal(resolution.notificationResolution(sprint, context(), now), null);
  assert.equal(
    resolution.notificationResolution(sprint, context({ sprints: new Map([["sprint-1", { id: "sprint-1", status: "closed", scoreLocked: true, reviewDueAt: "2026-07-11" }]]) }), now).reason,
    "sprint_closed",
  );

  const event = { ...baseNotification, type: "event.upcoming", recipientProfileId: "founder-1", entityType: "founder_event", entityId: "7" };
  assert.equal(resolution.notificationResolution(event, context(), now), null);
  assert.equal(
    resolution.notificationResolution(event, context({ events: new Map([["7", { ...baseEvent, participantProfileIds: ["other"] }]]) }), now).reason,
    "recipient_changed",
  );
  assert.equal(
    resolution.notificationResolution(event, context({ events: new Map([["7", { ...baseEvent, startsAt: "2026-08-15T10:00:00.000Z" }]]) }), now).reason,
    "event_outside_reminder_window",
  );

  const informational = { ...baseNotification, type: "task.comment" };
  assert.equal(resolution.notificationResolution(informational, context(), now), null);
  assert.equal(resolution.notificationResolution(informational, context({ tasks: new Map() }), now).reason, "source_deleted");
  assert.equal(resolution.notificationResolution({ ...baseNotification, type: "unknown.type" }, context(), now), undefined);
  assert.equal(resolution.notificationResolution(event, context({ events: undefined }), now), undefined);
});

test("pure reconciliation rules process more than one hundred open events", () => {
  const events = Array.from({ length: 125 }, (_, index) => ({ ...baseNotification, id: index + 1, type: "task.comment" }));
  const resolved = events.filter((event) => resolution.notificationResolution(event, context({ tasks: new Map() }), now));
  assert.equal(resolved.length, 125);
});

function fakeReconciliationSupabase(rows, { taskError = false } = {}) {
  const updated = [];
  return {
    updated,
    from(table) {
      if (table !== "notification_events") {
        return {
          select() { return this; },
          in() {
            return Promise.resolve({
              data: [],
              error: table === "tasks" && taskError ? { message: "source unavailable" } : null,
            });
          },
        };
      }

      let mode = "select";
      let cursor = 0;
      let limit = 200;
      let payload = null;
      let ids = [];
      const query = {
        select() { mode = "select"; return query; },
        update(value) { mode = "update"; payload = value; return query; },
        eq() {
          if (mode === "update") {
            for (const row of rows.filter((item) => ids.includes(item.id) && item.status === "pending")) {
              Object.assign(row, payload);
              updated.push(row.id);
            }
            return Promise.resolve({ data: null, error: null });
          }
          return query;
        },
        gt(_column, value) { cursor = value; return query; },
        order() { return query; },
        limit(value) { limit = value; return query; },
        or() { return query; },
        in(_column, value) { ids = value; return query; },
        then(resolve) {
          const data = rows.filter((row) => row.status === "pending" && row.id > cursor).slice(0, limit);
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return query;
    },
  };
}

test("server reconciliation paginates beyond one hundred and fails safe on source errors", async () => {
  const rows = Array.from({ length: 125 }, (_, index) => ({
    id: index + 1,
    type: "task.comment",
    actor_profile_id: null,
    recipient_profile_id: null,
    entity_type: "task",
    entity_id: `deleted-${index}`,
    title: "Deleted task",
    body: null,
    status: "pending",
    seen_at: null,
    dismissed_at: null,
    resolved_at: null,
    resolution_reason: null,
    created_at: now.toISOString(),
  }));
  const database = fakeReconciliationSupabase(rows);
  const result = await resolution.reconcileNotificationEvents(database, { pageSize: 40, now });
  assert.deepEqual({ ok: result.ok, checked: result.checked, resolved: result.resolved }, { ok: true, checked: 125, resolved: 125 });
  assert.equal(database.updated.length, 125);

  const sourceFailureRows = rows.map((row, index) => ({ ...row, id: index + 200, status: "pending", resolved_at: null, resolution_reason: null }));
  const failingDatabase = fakeReconciliationSupabase(sourceFailureRows, { taskError: true });
  const failSafeResult = await resolution.reconcileNotificationEvents(failingDatabase, { pageSize: 40, now });
  assert.deepEqual({ ok: failSafeResult.ok, checked: failSafeResult.checked, resolved: failSafeResult.resolved }, { ok: true, checked: 125, resolved: 0 });
  assert.equal(failingDatabase.updated.length, 0);
});

test("user lifecycle actions keep seen open and reserve team notifications for operational leads", () => {
  assert.equal(lifecycle.canManageNotificationEvent({ id: "viewer-1", platformRole: "viewer" }, "viewer-1"), true);
  assert.equal(lifecycle.canManageNotificationEvent({ id: "ceo-1", platformRole: "ceo" }, "viewer-1"), false);
  assert.equal(lifecycle.canManageNotificationEvent({ id: "ceo-1", platformRole: "ceo" }, null), true);
  assert.equal(lifecycle.canManageNotificationEvent({ id: "founder-1", platformRole: "founder" }, null), false);

  const seen = lifecycle.applyLocalNotificationAction(baseNotification, "seen", now);
  assert.equal(seen.status, "pending");
  assert.equal(seen.seenAt, now.toISOString());
  const dismissed = lifecycle.applyLocalNotificationAction(seen, "dismiss", now);
  assert.equal(dismissed.status, "dismissed");
  assert.equal(dismissed.dismissedAt, now.toISOString());
});

test("migration and routes enforce lifecycle persistence reconciliation and ownership", async () => {
  const migration = await readFile("supabase/0052_notification_lifecycle.sql", "utf8");
  const route = await readFile("src/app/api/notifications/[id]/route.ts", "utf8");
  const reconciliation = await readFile("src/lib/notification-resolution.ts", "utf8");
  const reviewReopen = await readFile("src/app/api/tasks/[id]/review/reopen/route.ts", "utf8");

  assert.match(migration, /add column if not exists seen_at/);
  assert.match(migration, /notification_events_unseen_recipient_created_idx/);
  assert.match(migration, /where status = 'pending' and seen_at is null/);
  assert.match(migration, /recipient_profile_id is null/);
  assert.match(migration, /current_platform_role\(\) in \('ceo', 'deputy'\)/);
  assert.match(route, /requireTeamMember/);
  assert.match(route, /canManageNotificationEvent/);
  assert.match(route, /\["seen", "dismiss"\]/);
  assert.doesNotMatch(route, /action.*resolved/);
  assert.match(reconciliation, /\.gt\("id", cursor\)/);
  assert.match(reconciliation, /\.limit\(pageSize\)/);
  assert.match(reconciliation, /while \(true\)/);
  assert.match(reviewReopen, /createNotificationPayload\("task\.review_reopened"/);
});
