import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { withPlanningCredentialDatabase } from "./helpers/planning-credential-database";

async function json(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(`Synthetic Workweek fixture RPC rejected (${response.status}, ${body.code || "unknown"})`);
  return body;
}

it("public Workweek capabilities preserve real owner preparation and confirmed-effect accounting after session loss", () => withPlanningCredentialDatabase(async f => {
  const owner = f.actors.viewer;
  const week = (await f.db.query("select (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::text as week")).rows[0].week;
  const draft = await json(await f.rpc("create_private_team_workweek_version", { p_effective_from: week, p_windows: [{ weekday: 6, startMinute: 690, endMinute: 960 }] }, "viewer"));
  const foreign = await json(await f.rpc("create_private_team_workweek_version", { p_effective_from: week, p_windows: [{ weekday: 5, startMinute: 600, endMinute: 900 }] }, "other"));
  await f.db.query(`insert into public.google_workspace_connections(profile_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,oauth_scopes,token_type,primary_calendar_id)
    values($1,$2,$3,now()+interval '1 hour',now()+interval '2 hours',$4,'Bearer','primary')`, [owner.profileId, f.encrypt("synthetic-planning-calendar"), f.encrypt("synthetic-planning-refresh"), ["https://www.googleapis.com/auth/calendar.events.owned"]]);
  let writes = 0, revokeOnWrite = true;
  const events = new Map<string, Record<string, unknown>>();
  f.setProvider(async request => {
    const url = new URL(request.url), eventId = url.pathname.split("/").at(-1)!;
    if (request.method === "GET") {
      if (eventId === "events") return Response.json({ items: [...events.values()] });
      return events.has(eventId) ? Response.json(events.get(eventId)) : new Response(null, { status: 404 });
    }
    if (request.method !== "POST" || eventId !== "events") throw new Error("Unscripted Calendar mutation in Workweek acceptance");
    writes++;
    const payload = await request.json() as Record<string, unknown>;
    const event = { ...payload, etag: '"synthetic-confirmed"' };
    events.set(String(payload.id), event);
    if (revokeOnWrite) { revokeOnWrite = false; await f.db.query("delete from auth.sessions where id=$1", [owner.sessionId]); }
    return Response.json(event);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const authorize = (targetId: string) => authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("viewer", "/api/team-workweek/publish") }, action: "workweek.publish", targetId });
  const wrongOwner = await authorize(foreign.id);
  if (!wrongOwner.ok) throw new Error("Owner preparation denial must cross the resource capability");
  await expect(wrongOwner.planning.detectWorkweekConflict()).rejects.toMatchObject({ code: "not_found" });
  expect(writes).toBe(0);
  const foreignPreparation = await f.rpc("prepare_team_workweek_publication", { p_version_id: foreign.id, p_write_journal_version: 1 }, "viewer");
  expect(foreignPreparation.status).toBe(403);
  expect((await foreignPreparation.json()).code).toBe("42501");
  const read = await authorizeCredentialAction({ credential: { kind: "session-request", request: f.request("viewer", "/api/team-workweek/conflict") }, action: "workweek.conflict.read" });
  if (!read.ok) throw new Error("Expected owner conflict-read capability");
  await expect(read.planning.publishWorkweek()).rejects.toMatchObject({ code: "forbidden" });
  const bound = await authorize(draft.id);
  if (!bound.ok) throw new Error("Expected owner publication capability");
  expect(bound.planning).not.toHaveProperty("bookkeeping");
  expect(bound.planning).not.toHaveProperty("recordWrite");
  expect(await bound.planning.detectWorkweekConflict()).toMatchObject({ state: "clear" });
  await expect(bound.planning.publishWorkweek()).rejects.toMatchObject({ completionPending: true });
  expect(writes).toBe(1);
  const publication = (await f.db.query("select id,status,attempt_generation from public.team_workweek_publications where source_version_id=$1", [draft.id])).rows[0];
  expect(publication.status).toBe("preparing");
  const journal = (await f.db.query(`select operation.state as operation_state,write.state as write_state,effect.state as effect_state,effect.confirmed_etag
    from public.team_workweek_provider_operations operation
    join public.team_workweek_provider_writes write on write.operation_id=operation.id
    join public.team_workweek_publication_effects effect on effect.id=write.effect_id
    where operation.publication_id=$1`, [publication.id])).rows;
  expect(journal).toHaveLength(1);
  expect(journal[0]).toMatchObject({ operation_state: "settled", write_state: "settled", effect_state: "confirmed", confirmed_etag: '"synthetic-confirmed"' });
  expect((await f.db.query("select count(*)::int as count from public.team_workweek_publications where source_version_id=$1", [foreign.id])).rows[0].count).toBe(0);
  await expect(bound.planning.publishWorkweek()).rejects.toBeDefined();
  expect(writes).toBe(1);
  expect(await authorize(draft.id)).toMatchObject({ ok: false, status: 401 });

  // A separate authenticated retry may complete the existing transaction, without replaying the confirmed provider write.
  await f.db.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now())", [owner.sessionId, owner.userId]);
  const retry = await authorize(draft.id);
  if (!retry.ok) throw new Error("Expected separately authenticated retry");
  expect(await retry.planning.detectWorkweekConflict()).toMatchObject({ state: "clear" });
  expect(await retry.planning.publishWorkweek()).toMatchObject({ id: publication.id, status: "published", syncState: "confirmed" });
  expect(writes).toBe(1);
  expect((await f.db.query("select status from public.team_workweek_publications where id=$1", [publication.id])).rows[0].status).toBe("published");
}), 30_000);

it("real Workweek claims retain service-only roles, exact effect binding and uncertain lease fencing", () => withPlanningCredentialDatabase(async f => {
  const week = (await f.db.query("select (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::text as week")).rows[0].week;
  const prepare = async (actor: "viewer" | "other") => {
    const version = await json(await f.rpc("create_private_team_workweek_version", { p_effective_from: week, p_windows: [{ weekday: 6, startMinute: 690, endMinute: 960 }] }, actor));
    return json(await f.rpc("prepare_team_workweek_publication", { p_version_id: version.id, p_write_journal_version: 1 }, actor));
  };
  const own = await prepare("viewer"), foreign = await prepare("other");
  expect(own.effects.length).toBeGreaterThan(0);
  expect(foreign.effects.length).toBeGreaterThan(0);
  const effect = own.effects[0];
  const claimBody = { p_publication_id: own.id, p_generation: own.attemptGeneration, p_purpose: "publish" };
  for (const actor of ["viewer", "other", "ceo", "administrator", "unmapped", "anonymous"] as const) {
    const denied = await f.rpc("claim_team_workweek_provider_operation", claimBody, actor);
    expect([401, 403]).toContain(denied.status);
  }
  const claim = await json(await f.rpc("claim_team_workweek_provider_operation", claimBody));
  expect(claim.state).toBe("claimed");
  const occupied = await json(await f.rpc("claim_team_workweek_provider_operation", claimBody));
  expect(occupied).toMatchObject({ state: "in_progress", id: claim.id });
  const record = (id: string, state: string, operationId = claim.id, actor: "service" | "viewer" | "other" = "service") => f.rpc("record_team_workweek_provider_write", { p_operation_id: operationId, p_effect_id: id, p_state: state }, actor);
  expect((await record(effect.id, "dispatched", claim.id, "viewer")).status).toBe(403);
  expect((await record(effect.id, "dispatched", claim.id, "other")).status).toBe(403);
  const foreignEffect = await record(foreign.effects[0].id, "dispatched");
  expect(foreignEffect.ok).toBe(false);
  expect((await foreignEffect.json()).code).toBe("P0003");
  const unknownClaim = await record(effect.id, "dispatched", randomUUID());
  expect(unknownClaim.ok).toBe(false);
  expect((await unknownClaim.json()).code).toBe("P0002");
  await json(await record(effect.id, "dispatched"));
  await f.db.query("update public.team_workweek_provider_operations set created_at=clock_timestamp()-interval '31 seconds' where id=$1", [claim.id]);
  expect(await json(await f.rpc("claim_team_workweek_provider_operation", claimBody))).toMatchObject({ state: "uncertain", id: claim.id });
  const lease = (await f.db.query("select count(*)::int as count from public.team_workweek_provider_operations where publication_id=$1 and state<>'settled'", [own.id])).rows[0];
  expect(lease.count).toBe(1);
  const replayAsNewWrite = await record(effect.id, "dispatched");
  expect(replayAsNewWrite.ok).toBe(false);
  expect((await replayAsNewWrite.json()).code).toBe("P0003");
  const staleGeneration = await f.rpc("confirm_team_workweek_effect", { p_effect_id: effect.id, p_generation: own.attemptGeneration + 1, p_etag: "stale", p_payload: effect.payload });
  expect(staleGeneration.ok).toBe(false);
  expect((await staleGeneration.json()).code).toBe("P0003");
  expect((await f.rpc("confirm_team_workweek_effect", { p_effect_id: effect.id, p_generation: own.attemptGeneration, p_etag: "forbidden", p_payload: effect.payload }, "viewer")).status).toBe(403);
  await json(await record(effect.id, "replaying"));
  await json(await record(effect.id, "settled"));
  expect(await json(await f.rpc("finish_team_workweek_provider_operation", { p_operation_id: claim.id }))).toMatchObject({ state: "settled" });
  const settledWrite = await record(effect.id, "dispatched");
  expect(settledWrite.ok).toBe(false);
  expect((await settledWrite.json()).code).toBe("P0003");
  const next = await json(await f.rpc("claim_team_workweek_provider_operation", claimBody));
  expect(next.state).toBe("claimed");
  expect(next.id).not.toBe(claim.id);
  const cancelled = await json(await f.rpc("request_team_workweek_publication_restart", { p_publication_id: own.id, p_owner_profile_id: f.actors.viewer.profileId }));
  expect(cancelled.state).toBe("ready");
  expect((await record(effect.id, "dispatched", next.id)).ok).toBe(false);
  expect((await f.db.query("select count(*)::int as count from public.team_workweek_provider_writes where effect_id=$1", [foreign.effects[0].id])).rows[0].count).toBe(0);
}), 30_000);
