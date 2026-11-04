import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

type Fixture = Parameters<Parameters<typeof withPlanningCredentialDatabase>[0]>[0];

async function withPersonalPlanningDatabase(run: (fixture: Fixture) => Promise<void>) {
  await withPlanningCredentialDatabase(async fixture => {
    try { await run(fixture); } finally {
      const profiles = Object.values(fixture.actors).map(actor => actor.profileId);
      await fixture.db.query("delete from public.planning_github_projection_outbox where actor_profile_id=any($1)", [profiles]);
      await fixture.db.query("delete from public.team_planning_item_update_requests where profile_id=any($1)", [profiles]);
      await fixture.db.query("delete from public.team_task_intake_tokens where profile_id=any($1)", [profiles]);
    }
  });
}

async function personalApi(fixture: Fixture, actor: "deputy" | "founder" | "other" = "deputy") {
  const tokens = await importTestModule("src/app/api/team/planning-items/v2/tokens/route.ts", { "server-only": {} });
  const updates = await importTestModule("src/app/api/team/planning-items/v2/items/[id]/route.ts", { "server-only": {} });
  const previews = await importTestModule("src/app/api/team/planning-items/v2/items/[id]/preview/route.ts", { "server-only": {} });
  const context = await importTestModule("src/app/api/team/planning-items/v2/context/route.ts", { "server-only": {} });
  const issued = await tokens.POST(fixture.request(actor, "/api/team/planning-items/v2/tokens", "POST", {
    label: "Synthetic review evidence", allowUpdates: true, allowGitHubSync: true,
  }));
  expect(issued.status).toBe(200);
  const credential = await issued.json();
  if (typeof credential.token !== "string") throw new Error("Expected a personal Planning credential");
  const request = (path: string, method: string, body?: unknown, idempotencyKey?: string) => new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { authorization: `Bearer ${credential.token}`, "content-type": "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const preview = (id: string, body: unknown) => previews.POST(request(`/api/team/planning-items/v2/items/${id}/preview`, "POST", body), { params: Promise.resolve({ id }) });
  return {
    tokenId: credential.tokenRecord.id as string,
    preview,
    save: (id: string, body: unknown, key = randomUUID()) => updates.PATCH(request(`/api/team/planning-items/v2/items/${id}`, "PATCH", body, key), { params: Promise.resolve({ id }) }),
    async read(id: string) {
      const response = await context.GET(request("/api/team/planning-items/v2/context", "GET"));
      expect(response.status).toBe(200);
      const body = await response.json();
      const item = body.context.items.find((candidate: { id: string }) => candidate.id === id);
      if (!item) throw new Error("Expected the synthetic Deliverable in Planning context");
      const inspected = await preview(id, { expectedUpdatedAt: item.updatedAt, status: item.status });
      expect(inspected.status).toBe(200);
      return (await inspected.json()).currentItem;
    },
    async createTask(suffix: string) {
      const id = `${fixture.prefix}-${suffix}`;
      await fixture.db.query(`insert into public.tasks
        (id,project_id,title,task_type,status,priority,approval_status,parent_task_id,owner,assignee,review_owner_profile_id)
        values($1,'findmydoc-founder-execution','Synthetic cost plan','deliverable','In Arbeit','P2','approved',$2,$3,$3,$4)`,
      [id, fixture.initiativeId, fixture.actors.founder.profileId, fixture.actors.ceo.profileId]);
      return id;
    },
  };
}

it("personal Planning API saves an evidence URL and reads it back before requesting review", async () => {
  await withPersonalPlanningDatabase(async fixture => {
    const api = await personalApi(fixture);
    const id = await api.createTask("evidence-only");
    const before = await api.read(id);
    const evidenceLink = "https://docs.google.com/spreadsheets/d/synthetic-cost-plan/edit?mode=review";
    const patch = { expectedUpdatedAt: before.updatedAt, evidenceLink };
    expect((await api.preview(id, patch)).status).toBe(200);
    const saved = await api.save(id, patch);
    expect(await saved.json()).toMatchObject({ ok: true });
    expect(saved.status).toBe(200);
    expect(await api.read(id)).toMatchObject({ status: "In Arbeit", evidenceLink });
  });
}, 60_000);

it.each(["stored evidence", "explicit exception"])("personal Planning API requests review with %s", async mode => {
  await withPersonalPlanningDatabase(async fixture => {
    const api = await personalApi(fixture);
    const id = await api.createTask(mode.replaceAll(" ", "-"));
    let before = await api.read(id);
    if (mode === "stored evidence") {
      expect((await api.save(id, { expectedUpdatedAt: before.updatedAt, evidenceLink: "https://example.test/proof" })).status).toBe(200);
      before = await api.read(id);
    }
    const evidenceExceptionNote = mode === "explicit exception" ? "Accepted in the founder meeting." : undefined;
    const saved = await api.save(id, { expectedUpdatedAt: before.updatedAt, status: "Review", ...(evidenceExceptionNote ? { evidenceExceptionNote } : {}) });
    expect(saved.status).toBe(200);
    expect(await api.read(id)).toMatchObject({ status: "Review", reviewStatus: "requested", evidenceExceptionNote: evidenceExceptionNote || "" });
  });
}, 60_000);

it("personal Planning API preserves evidence on conflicts, forbidden edits and active review locks", async () => {
  await withPersonalPlanningDatabase(async fixture => {
    const api = await personalApi(fixture, "founder");
    const other = await personalApi(fixture, "other");
    const id = await api.createTask("guarded-evidence");
    const before = await api.read(id);
    expect((await api.save(id, { expectedUpdatedAt: before.updatedAt, title: "Updated synthetic cost plan" })).status).toBe(200);
    const current = await api.read(id);
    expect((await api.save(id, { expectedUpdatedAt: before.updatedAt, evidenceLink: "https://example.test/stale", status: "Review" })).status).toBe(409);
    expect((await other.save(id, { expectedUpdatedAt: current.updatedAt, evidenceLink: "https://example.test/forbidden" })).status).toBe(403);
    expect(await api.read(id)).toEqual(current);
    expect((await api.save(id, { expectedUpdatedAt: current.updatedAt, evidenceLink: "https://example.test/accepted", status: "Review" })).status).toBe(200);
    const reviewed = await api.read(id);
    expect((await api.save(id, { expectedUpdatedAt: reviewed.updatedAt, evidenceLink: "https://example.test/locked" })).status).toBe(409);
    expect(await api.read(id)).toEqual(reviewed);
  });
}, 60_000);

it("personal Planning API cannot remove its sole evidence while entering review", async () => {
  await withPersonalPlanningDatabase(async fixture => {
    const api = await personalApi(fixture);
    const id = await api.createTask("evidence-rollback");
    const empty = await api.read(id);
    expect((await api.save(id, { expectedUpdatedAt: empty.updatedAt, evidenceLink: "https://example.test/retained" })).status).toBe(200);
    const before = await api.read(id);
    const rejected = await api.save(id, { expectedUpdatedAt: before.updatedAt, evidenceLink: "", status: "Review" });
    expect(rejected.status).toBe(409);
    expect(await api.read(id)).toEqual(before);
    expect((await fixture.db.query("select url from public.task_links where task_id=$1 and type='evidence'", [id])).rows).toEqual([{ url: "https://example.test/retained" }]);
  });
}, 60_000);

it("personal Planning transaction records one projection on replay and remains service-only", async () => {
  await withPersonalPlanningDatabase(async fixture => {
    const api = await personalApi(fixture);
    const id = await api.createTask("durable-projection");
    const before = await api.read(id);
    const command = {
      p_token_id: api.tokenId, p_profile_id: fixture.actors.deputy.profileId, p_item_type: "deliverable", p_item_id: id,
      p_expected_updated_at: before.updatedAt, p_idempotency_key: randomUUID(), p_request_hash: "a".repeat(64),
      p_patch: { evidence_link: "https://example.test/projected", status: "Review" },
      p_changed_fields: ["evidenceLink", "status"], p_projection_command: { createIfMissing: true },
    };
    const operation = "update_team_planning_item_with_review_evidence_transaction_v1";
    for (const [actor, status] of [["anonymous", 401], ["founder", 403]] as const) {
      expect((await fixture.rpc(operation, command, actor)).status).toBe(status);
    }
    const first = await fixture.rpc(operation, command);
    expect(first.status).toBe(200);
    const committed = await first.json();
    expect(committed.item).toMatchObject({ status: "Review", evidence_link: "https://example.test/projected" });
    const replay = await fixture.rpc(operation, command);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, projectionOperationId: committed.projectionOperationId });
    expect((await fixture.db.query("select count(*)::int as count from public.planning_github_projection_outbox where task_id=$1", [id])).rows).toEqual([{ count: 1 }]);
  });
}, 60_000);

it("personal Planning API rejects invalid evidence before both preview and persistence", async () => {
  await withPersonalPlanningDatabase(async fixture => {
    const api = await personalApi(fixture);
    const id = await api.createTask("invalid-evidence");
    const before = await api.read(id);
    for (const evidenceLink of ["not-a-url", "javascript:alert(1)", `https://example.test/${"a".repeat(2048)}`]) {
      const patch = { expectedUpdatedAt: before.updatedAt, evidenceLink };
      expect((await api.preview(id, patch)).status).toBe(400);
      expect((await api.save(id, patch)).status).toBe(400);
      expect(await api.read(id)).toEqual(before);
    }
  });
}, 60_000);

it("personal Planning API saves evidence and requests review atomically with an idempotent receipt", async () => {
  await withPersonalPlanningDatabase(async fixture => {
    const api = await personalApi(fixture);
    const id = await api.createTask("evidence-and-review");
    const before = await api.read(id);
    const evidenceLink = "https://docs.google.com/spreadsheets/d/synthetic-cost-plan/edit";
    const patch = { expectedUpdatedAt: before.updatedAt, evidenceLink, status: "Review" };
    const preview = await api.preview(id, patch);
    expect(preview.status).toBe(200);
    expect((await preview.json()).changedFields).toEqual(["evidenceLink", "status"]);
    const key = randomUUID();
    const saved = await api.save(id, patch, key);
    expect(await saved.json()).toMatchObject({ ok: true });
    expect(saved.status).toBe(200);
    const confirmed = await api.read(id);
    expect(confirmed).toMatchObject({ status: "Review", evidenceLink, reviewStatus: "requested", reviewOwnerProfileId: fixture.actors.ceo.profileId });
    expect(confirmed.reviewRequestedAt).not.toBe("");
    const replay = await api.save(id, patch, key);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, replayed: true });
    expect(await api.read(id)).toEqual(confirmed);
    const effects = await fixture.db.query(`select
      (select count(*)::int from public.notification_events where entity_id=$1 and type='task.review_requested') as notifications,
      (select count(*)::int from public.task_activity where task_id=$1 and message like 'Status geändert:%') as activities`, [id]);
    expect(effects.rows).toEqual([{ notifications: 1, activities: 1 }]);
  });
}, 60_000);
