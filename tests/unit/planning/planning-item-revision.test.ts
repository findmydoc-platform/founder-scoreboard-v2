import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthzResult } from "@/lib/authz";
import type { TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import type { AuthenticatedProfile } from "@/lib/types";
import { createPlanningItemRevision } from "@/features/planning-items/model/planning-item-revision";

vi.mock("server-only", () => ({}));

const revision = "2026-09-24T10:00:00.000Z";
const permission = {
  ok: true as const,
  profile: { id: "owner", name: "Owner", platformRole: "founder" } as AuthenticatedProfile,
};

function database(taskOverrides: Record<string, unknown> = {}) {
  const task = {
    id: "deliverable", title: "Planning revision", task_type: "deliverable",
    project_id: "findmydoc-founder-execution", trashed_at: null,
    status: "In Arbeit", approval_status: "approved", approval_revision: 2,
    owner: "owner", assignee: "owner", parent_task_id: null,
    review_status: "not_requested", review_owner_profile_id: "reviewer",
    score_final: false, sprint_id: null, score_relevant: false,
    updated_at: revision, ...taskOverrides,
  };
  const rpc = vi.fn<(...args: unknown[]) => Promise<{ data: unknown; error: null | { code: string; message: string } }>>(async () => { throw new Error("Unexpected transaction"); });
  const rows: Record<string, Record<string, unknown>[]> = { tasks: [task], active_tasks: [task], profiles: [], sprints: [] };
  const client = {
    rpc,
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const result = () => ({ data: (rows[table] || []).filter((row) => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)), error: null });
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters.push([key, value]); return query; },
        in(key: string, values: unknown[]) { filters.push([key, values]); return query; },
        order() { return query; },
        limit() { return query; },
        returns() { return query; },
        single: async () => ({ ...result(), data: result().data[0] || null }),
        maybeSingle: async () => ({ ...result(), data: result().data[0] || null }),
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, task, rows, rpc };
}

test("Browser unchanged status returns the current revision without writing", async () => {
  const db = database();
  const result = await createPlanningItemRevision(db.client).commitBrowserRevision({
    itemId: "deliverable", payload: { expectedUpdatedAt: revision, status: "In Arbeit" }, permission,
  });
  expect(result).toMatchObject({ ok: true, value: { activities: [], task: { id: "deliverable", updatedAt: revision, approvalRevision: 2, sprintId: "", scoreRelevant: false } } });
  expect(db.rpc).not.toHaveBeenCalled();
});

test("GitHub unchanged title succeeds without a write", async () => {
  const db = database();
  const result = await createPlanningItemRevision(db.client).commitGitHubRevision({
    task: { id: "deliverable", updatedAt: revision },
    actor: { profileId: "owner", name: "Owner", platformRole: "founder" },
    patch: { title: "Planning revision" },
  });
  expect(result).toEqual({ ok: true, status: "unchanged" });
  expect(db.rpc).not.toHaveBeenCalled();
});

function browser(db: ReturnType<typeof database>, payload: TaskUpdatePayload, auth = permission as Extract<AuthzResult, { ok: true }>) {
  return createPlanningItemRevision(db.client).commitBrowserRevision({ itemId: "deliverable", payload: { expectedUpdatedAt: revision, ...payload }, permission: auth });
}

function github(db: ReturnType<typeof database>, patch: Record<string, unknown>) {
  return createPlanningItemRevision(db.client).commitGitHubRevision({
    task: { id: "deliverable", updatedAt: revision },
    actor: { profileId: "owner", name: "Owner", platformRole: "founder" }, patch,
  });
}

const ceo = { ...permission, profile: { ...permission.profile, platformRole: "ceo" as const } };
const administrator = {
  ...permission, profile: { ...permission.profile, platformRole: "viewer" },
  authority: { capabilities: { operationalCorrection: true } },
} as Extract<AuthzResult, { ok: true }>;

test("Browser commits combined ownership, status, sprint, evidence and notes atomically", async () => {
  const db = database({ parent_task_id: "initiative" });
  db.rows.active_tasks.push({ id: "initiative", task_type: "initiative", status: "In Arbeit", review_status: "not_requested", score_final: false });
  db.rows.sprints.push({ id: "sprint", score_locked: false });
  const updatedAt = "2026-09-24T11:00:00.000Z";
  db.rpc.mockResolvedValue({ error: null, data: {
    task: { updated_at: updatedAt, approval_status: "approved", approval_revision: 2, sprint_id: "sprint", score_relevant: true },
    activities: [{ id: 42, task_id: "deliverable", message: "Status geändert: In Arbeit → Blockiert", created_at: updatedAt }],
  } });
  const result = await browser(db, {
    ownerId: "New Owner", status: "Blockiert", sprintId: "sprint", note: "Context", dependsOn: "  external blocker  ",
    evidenceLinks: ["https://example.com/evidence", "https://example.com/second"], selfDodChecked: true,
  }, ceo);
  expect(db.rpc).toHaveBeenCalledTimes(1);
  expect(db.rpc).toHaveBeenCalledWith("update_browser_planning_task_transaction_v2", expect.objectContaining({
    p_task_id: "deliverable", p_expected_updated_at: revision, p_actor_profile_id: "owner",
    p_task_patch: expect.objectContaining({ assignee: "new-owner", owner: "new-owner", status: "Blockiert", sprint_id: "sprint", score_relevant: true, evidence_link: "https://example.com/evidence", evidence_links: ["https://example.com/evidence", "https://example.com/second"], self_dod_checked: true, github_issue_sync_status: "not_synced" }),
    p_note_present: true, p_note: "Context", p_dependency_present: true, p_dependency_note: "external blocker",
    p_activity_messages: expect.arrayContaining(["Notiz aktualisiert", "Founder-Checkliste aktualisiert"]), p_notifications: [],
  }));
  expect(result).toMatchObject({ ok: true, value: {
    task: { id: "deliverable", status: "Blockiert", ownerId: "new-owner", updatedAt, sprintId: "sprint", scoreRelevant: true, evidenceLinks: ["https://example.com/evidence", "https://example.com/second"] },
    activities: [{ id: 42, taskId: "deliverable", action: "task.status_changed", actorProfileId: "owner", createdAt: updatedAt }],
  } });
});

test("Browser strategic revision commits strategy, RACI and mentions with the administrator transaction", async () => {
  const db = database({ task_type: "initiative" });
  db.rpc.mockImplementation(async (name) => {
    if (name === "administrator_directory_snapshot") return { data: { people: [{ id: "mentioned", name: "Mentioned", githubLogin: "mentioned" }] }, error: null };
    return { data: { task: { ...db.task, description: "Hello @mentioned", updated_at: "2026-09-24T11:00:00.000Z" } }, error: null };
  });
  const result = await browser(db, {
    description: "Hello @mentioned", parentTaskId: "Epic Parent",
    strategy: { goal: "  Goal  ", successCriteria: "Measured", scopeConstraints: "Scope" },
    raciAssignments: [{ profileId: "Mentioned", role: "accountable", sortOrder: 0 }],
  }, administrator);
  expect(db.rpc).toHaveBeenLastCalledWith("update_administrator_planning_item_transaction_v2", expect.objectContaining({
    p_patch: { description: "Hello @mentioned", parent_task_id: "epic-parent" },
    p_strategy: { goal: "Goal", successCriteria: "Measured", scopeConstraints: "Scope" },
    p_raci_assignments: [{ profileId: "mentioned", role: "accountable", sortOrder: 0 }],
    p_notifications: [expect.objectContaining({ recipient_profile_id: "mentioned", entity_id: "deliverable" })],
    p_request_ip: null, p_user_agent: null,
  }));
  expect(db.rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty("p_actor_profile_id");
  expect(result).toMatchObject({ ok: true, value: { activities: [], task: {
    description: "Hello @mentioned", strategy: { goal: "Goal", successCriteria: "Measured", scopeConstraints: "Scope" },
    raciAssignments: [{ profileId: "mentioned", role: "accountable" }],
  } } });
});

test("Browser late administrator denial resolves the expired access code", async () => {
  const db = database();
  db.rpc.mockImplementation(async (name) => name === "administrator_access_snapshot"
    ? { data: { eligible: true, active: false }, error: null }
    : { data: null, error: { code: "42501", message: "active administrator access required" } });
  const result = await browser(db, { title: "Corrected title" }, administrator);
  expect(db.rpc.mock.calls.map(([name]) => name)).toEqual(["update_administrator_planning_task_transaction_v2", "administrator_access_snapshot"]);
  expect(result).toEqual({ ok: false, error: { kind: "forbidden", code: "administrator_access_expired", message: "Der Adminzugang ist abgelaufen." } });
});

test.each([
  ["unmapped session", {}, { ...permission, profile: null }, "forbidden"],
  ["unowned brief", { owner: "other", assignee: "other" }, permission, "forbidden"],
  ["active review", { review_status: "requested" }, permission, "conflict"],
  ["completed task", { status: "Erledigt" }, ceo, "conflict"],
  ["trashed task", { trashed_at: revision }, permission, "conflict"],
] as const)("Browser rejects %s before writing", async (_, overrides, auth, kind) => {
  const db = database(overrides);
  const result = await browser(db, { title: "Changed title" }, auth);
  expect(result).toMatchObject({ ok: false, error: { kind } });
  expect(db.rpc).not.toHaveBeenCalled();
});

test("Browser validates the current revision after the active-item guard", async () => {
  const db = database();
  expect(await browser(db, { expectedUpdatedAt: "invalid", title: "Changed title" })).toMatchObject({ ok: false, error: { kind: "invalidCommand", message: "Aktueller Aufgabenstand ist erforderlich." } });
  db.rows.tasks = [];
  expect(await browser(db, { title: "Changed title" })).toMatchObject({ ok: false, error: { kind: "notFound" } });
  expect(db.rpc).not.toHaveBeenCalled();
});

test("Browser rejects a locked target sprint before writing", async () => {
  const db = database({ parent_task_id: "initiative" });
  db.rows.active_tasks.push({ id: "initiative", task_type: "initiative" });
  db.rows.sprints.push({ id: "sprint", score_locked: true });
  expect(await browser(db, { sprintId: "sprint" }, ceo)).toMatchObject({ ok: false, error: { kind: "conflict" } });
  expect(db.rpc).not.toHaveBeenCalled();
});

test("Browser rejects edits beneath a parent in Review", async () => {
  const db = database({ task_type: "sub_issue", parent_task_id: "parent" });
  db.rows.active_tasks.push({ id: "parent", review_status: "requested", status: "Review" });
  expect(await browser(db, { title: "Changed title" })).toMatchObject({ ok: false, error: { kind: "conflict" } });
  expect(db.rpc).not.toHaveBeenCalled();
});

test("Browser exposes content validation details without committing", async () => {
  const db = database();
  expect(await browser(db, { title: "x".repeat(1000) })).toMatchObject({ ok: false, error: { kind: "invalidCommand", lengthErrors: expect.arrayContaining([expect.objectContaining({ field: "title", maximum: 240, excess: 760 })]) } });
  expect(db.rpc).not.toHaveBeenCalled();
});

test.each([
  ["P0001", "conflict", "Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden."],
  ["P0015", "conflict", "Sprint-Zuordnung konnte nicht gespeichert werden. Bitte neu laden."],
  ["P0002", "notFound", "Aufgabe wurde nicht gefunden."],
  ["P0006", "forbidden", "Aufgabenänderung ist nicht erlaubt."],
  ["23514", "invalidCommand", "Aufgabenänderung ist ungültig."],
  ["unavailable", "dependencyUnavailable", "Aufgabe konnte nicht gespeichert werden."],
])("Browser maps transaction error %s", async (code, kind, message) => {
  const db = database();
  db.rpc.mockResolvedValue({ data: null, error: { code, message: "Rejected" } });
  expect(await browser(db, { title: "Changed title" })).toEqual({ ok: false, error: { kind, message } });
});

test("GitHub commits normalized evidence and status activities without notifications", async () => {
  const db = database();
  db.rpc.mockResolvedValue({ data: null, error: null });
  expect(await github(db, { evidenceLink: "https://example.com/evidence", status: "Blockiert" })).toEqual({ ok: true, status: "committed" });
  expect(db.rpc).toHaveBeenCalledTimes(1);
  expect(db.rpc).toHaveBeenCalledWith("update_browser_planning_task_transaction_v2", expect.objectContaining({
    p_expected_updated_at: revision, p_actor_profile_id: "owner",
    p_task_patch: expect.objectContaining({ evidence_link: "https://example.com/evidence", evidence_links: ["https://example.com/evidence"], status: "Blockiert", github_issue_sync_status: "not_synced", github_issue_sync_error: null }),
    p_note_present: false, p_dependency_present: false, p_notifications: [],
    p_activity_messages: ["Status geändert: In Arbeit → Blockiert"],
  }));
});

test.each([
  ["stale revision", { updated_at: "2026-09-24T11:00:00.000Z" }, { title: "Changed title" }],
  ["unowned brief", { owner: "other", assignee: "other" }, { title: "Changed title" }],
  ["unsupported field", {}, { unknownField: true }],
  ["locked review", { review_status: "requested" }, { title: "Changed title" }],
])("GitHub rejects %s without writing", async (_, overrides, patch) => {
  const db = database(overrides);
  expect(await github(db, patch)).toEqual({ ok: false, error: { code: "rejected" } });
  expect(db.rpc).not.toHaveBeenCalled();
});

test("Source-specific transaction result requirements remain unchanged", async () => {
  const db = database();
  db.rpc.mockResolvedValue({ data: null, error: null });
  expect(await browser(db, { title: "Changed title" })).toMatchObject({ ok: false, error: { kind: "dependencyUnavailable" } });
  expect(await github(db, { title: "Changed title" })).toEqual({ ok: true, status: "committed" });
});

test("GitHub distinguishes transaction conflicts from database unavailability", async () => {
  const db = database();
  db.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "stale" } });
  expect(await github(db, { title: "Changed title" })).toEqual({ ok: false, error: { code: "conflict", reason: "revision" } });
  db.rpc.mockResolvedValueOnce({ data: null, error: { code: "08006", message: "unavailable" } });
  expect(await github(db, { title: "Changed title" })).toEqual({ ok: false, error: { code: "dependencyUnavailable", dependency: "database", retryable: true } });
});


test("Browser keeps its narrower no-op rule for an unchanged title", async () => {
  const db = database();
  db.rpc.mockResolvedValue({ data: { task: { updated_at: revision } }, error: null });
  expect(await browser(db, { title: "Planning revision" })).toMatchObject({ ok: true });
  expect(db.rpc).toHaveBeenCalledTimes(1);
  expect(await github(db, { title: "Planning revision" })).toEqual({ ok: true, status: "unchanged" });
  expect(db.rpc).toHaveBeenCalledTimes(1);
});

test("GitHub reopening applies the existing review and score effects", async () => {
  const db = database({ status: "Erledigt", review_status: "accepted", score_final: true, score_points: 5 });
  db.rpc.mockResolvedValue({ data: null, error: null });
  const result = await createPlanningItemRevision(db.client).commitGitHubRevision({
    task: { id: "deliverable", updatedAt: revision },
    actor: { profileId: "owner", name: "Owner", platformRole: "ceo" },
    patch: { status: "Offen" },
  });
  expect(result).toEqual({ ok: true, status: "committed" });
  expect(db.rpc).toHaveBeenCalledWith("update_browser_planning_task_transaction_v2", expect.objectContaining({
    p_task_patch: expect.objectContaining({ status: "Offen", score_final: false, review_status: "not_requested", review_requested_at: null }),
  }));
});
