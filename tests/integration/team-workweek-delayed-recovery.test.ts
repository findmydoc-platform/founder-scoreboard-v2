import { expect, it } from "vitest";
import pg from "pg";
import { asAuthenticated, captureDatabaseError, localDatabaseUrl, withIsolatedLocalDatabase } from "./helpers/local-database";
import { cleanupGoogleWorkweekEffect, ensureGoogleWorkweekEffect } from "../../src/features/team-workweek/server/team-workweek-immediate-effects";

const ownerUser = "bfa73001-0000-4000-8000-000000000001";
async function service<T>(client: Parameters<Parameters<typeof withIsolatedLocalDatabase>[0]>[0], operation: () => Promise<T>) {
  await client.query("select set_config('request.jwt.claim.role','service_role',true)");
  await client.query("set local role service_role");
  try { return await operation(); } finally { await client.query("reset role").catch(() => undefined); }
}

async function prepare(client: Parameters<Parameters<typeof withIsolatedLocalDatabase>[0]>[0], role = "viewer") {
  await client.query("insert into auth.users(id) values($1)", [ownerUser]);
  await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('delayed-owner',$1,'Owner',$2)", [ownerUser, role]);
  const draft = (await asAuthenticated(client, ownerUser, () => client.query("select public.create_private_team_workweek_version(date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7,'[{\"weekday\":6,\"startMinute\":690,\"endMinute\":960}]') as result"))).rows[0].result;
  return { draft, publication: (await asAuthenticated(client, ownerUser, () => client.query("select public.prepare_team_workweek_publication($1,1) as result", [draft.id]))).rows[0].result };
}

function journal(client: Parameters<Parameters<typeof withIsolatedLocalDatabase>[0]>[0], operationId: string, effectId: string) {
  const record = (state: string) => service(client, () => client.query("select public.record_team_workweek_provider_write($1,$2,$3)", [operationId, effectId, state])).then(() => undefined);
  return { beforeWrite: () => record("dispatched"), outcome: record };
}

it("fences a delayed Monday before cleanup and keeps the original generation immutable", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await client.query("insert into auth.users(id) values($1)", [ownerUser]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('delayed-owner',$1,'Owner','viewer')", [ownerUser]);
    const draft = (await asAuthenticated(client, ownerUser, () => client.query("select public.create_private_team_workweek_version(date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7,'[{\"weekday\":6,\"startMinute\":690,\"endMinute\":960}]') as result"))).rows[0].result;
    const publication = (await asAuthenticated(client, ownerUser, () => client.query("select public.prepare_team_workweek_publication($1,1) as result", [draft.id]))).rows[0].result;
    const claim = (await service(client, () => client.query("select public.claim_team_workweek_provider_operation($1,1,'publish') as result", [publication.id]))).rows[0].result;
    expect(claim.state).toBe("claimed");
    await service(client, () => client.query("select public.record_team_workweek_provider_write($1,$2,'dispatched')", [claim.id, publication.effects[0].id]));
    expect((await service(client, () => client.query("select public.request_team_workweek_publication_restart($1,'delayed-owner') as result", [publication.id]))).rows[0].result).toEqual({ state: "delayed", reason: "in_progress" });
    expect(await captureDatabaseError(client, () => asAuthenticated(client, ownerUser, () => client.query("select public.finalize_team_workweek_publication($1)", [publication.id])))).toMatchObject({ code: "P0003" });
    expect(await captureDatabaseError(client, () => service(client, () => client.query("select public.prepare_team_workweek_effect_cleanup($1,1)", [publication.id])))).toMatchObject({ code: "P0003" });
    await service(client, () => client.query("select public.record_team_workweek_provider_write($1,$2,'settled')", [claim.id, publication.effects[0].id]));
    await service(client, () => client.query("select public.finish_team_workweek_provider_operation($1)", [claim.id]));
    const cleanup = (await service(client, () => client.query("select public.prepare_team_workweek_effect_cleanup($1,1) as result", [publication.id]))).rows[0].result;
    expect(cleanup.effects.length).toBeGreaterThan(0);
    for (const effect of cleanup.effects) await service(client, () => client.query("select public.confirm_team_workweek_planned_cleanup($1,1,'absent',false)", [effect.id]));
    const fresh = (await asAuthenticated(client, ownerUser, () => client.query("select public.restart_private_team_workweek_version($1) as result", [draft.id]))).rows[0].result;
    expect(fresh.versionId).not.toBe(draft.id);
    const old = (await client.query("select status,effective_at,attempt_generation from public.team_workweek_publications where id=$1", [publication.id])).rows[0];
    expect(old.status).toBe("inactive");
    expect(old.effective_at.toISOString()).toBe(new Date(publication.effectiveAt).toISOString());
    expect(old.attempt_generation).toBe(1);
  });
}, 30_000);

it.each(["before-dispatch", "after-settlement"])("fences a stalled publisher %s without relying on a lease expiry", async phase => {
  await withIsolatedLocalDatabase(async client => {
    const { publication } = await prepare(client);
    const claim = (await service(client, () => client.query("select public.claim_team_workweek_provider_operation($1,1,'publish') as result", [publication.id]))).rows[0].result;
    if (phase === "after-settlement") {
      await service(client, () => client.query("select public.record_team_workweek_provider_write($1,$2,'dispatched')", [claim.id, publication.effects[0].id]));
      await service(client, () => client.query("select public.record_team_workweek_provider_write($1,$2,'settled')", [claim.id, publication.effects[0].id]));
    }
    expect((await service(client, () => client.query("select public.request_team_workweek_publication_restart($1,'delayed-owner') as result", [publication.id]))).rows[0].result.state).toBe("ready");
    expect(await captureDatabaseError(client, () => service(client, () => client.query("select public.record_team_workweek_provider_write($1,$2,'dispatched')", [claim.id, publication.effects[0].id])))).toMatchObject({ code: "P0003" });
    expect((await service(client, () => client.query("select public.claim_team_workweek_provider_operation($1,1,'cleanup') as result", [publication.id]))).rows[0].result.state).toBe("claimed");
  });
}, 30_000);

it("waits for an actual late Google response before compensating a cancelled generation", async () => {
  await withIsolatedLocalDatabase(async client => {
    const { publication } = await prepare(client);
    const effect = publication.effects[0];
    const claim = (await service(client, () => client.query("select public.claim_team_workweek_provider_operation($1,1,'publish') as result", [publication.id]))).rows[0].result;
    let release!: (value: Response) => void;
    let dispatched!: () => void;
    const started = new Promise<void>(resolve => { dispatched = resolve; });
    let event: Record<string, unknown> | null = null;
    const provider: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") {
        event = { ...effect.payload, etag: "late-etag" };
        dispatched();
        return new Promise<Response>(resolve => { release = resolve; });
      }
      if (init?.method === "DELETE") { event = null; return new Response(null, { status: 204 }); }
      return event ? Response.json(event) : new Response(null, { status: 404 });
    };
    const writing = ensureGoogleWorkweekEffect({ accessToken: "test", effect, fetchImpl: provider, writeJournal: journal(client, claim.id, effect.id) });
    await started;
    expect((await service(client, () => client.query("select public.request_team_workweek_publication_restart($1,'delayed-owner') as result", [publication.id]))).rows[0].result.reason).toBe("in_progress");
    expect((await service(client, () => client.query("select public.claim_team_workweek_provider_operation($1,1,'publish') as result", [publication.id]))).rows[0].result.state).toBe("in_progress");
    expect(await captureDatabaseError(client, () => service(client, () => client.query("select public.prepare_team_workweek_effect_cleanup($1,1)", [publication.id])))).toMatchObject({ code: "P0003" });
    release(Response.json(event));
    expect((await writing).state).toBe("confirmed");
    expect(await captureDatabaseError(client, () => service(client, () => client.query("select public.confirm_team_workweek_effect($1,1,'late-etag',$2)", [effect.id, effect.payload])))).toMatchObject({ code: "P0003" });
    await service(client, () => client.query("select public.finish_team_workweek_provider_operation($1)", [claim.id]));
    const cleanupClaim = (await service(client, () => client.query("select public.claim_team_workweek_provider_operation($1,1,'cleanup') as result", [publication.id]))).rows[0].result;
    const plan = (await service(client, () => client.query("select public.prepare_team_workweek_effect_cleanup($1,1) as result", [publication.id]))).rows[0].result;
    for (const target of plan.effects) {
      const result = await cleanupGoogleWorkweekEffect({ accessToken: "test", effect: target, fetchImpl: provider, writeJournal: journal(client, cleanupClaim.id, target.id) });
      expect(result.state).toBe("confirmed");
    }
    expect(event).toBeNull();
  });
}, 30_000);

it("keeps a timed-out dispatch uncertain across 404 observations and aging until its own event appears", async () => {
  await withIsolatedLocalDatabase(async client => {
    const { publication } = await prepare(client);
    const effect = publication.effects[0];
    const claim = (await service(client, () => client.query("select public.claim_team_workweek_provider_operation($1,1,'publish') as result", [publication.id]))).rows[0].result;
    let event: Record<string, unknown> | null = null;
    const provider: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") throw new DOMException("Response lost", "TimeoutError");
      return event ? Response.json(event) : new Response(null, { status: 404 });
    };
    const input = { accessToken: "test", effect, fetchImpl: provider, writeJournal: journal(client, claim.id, effect.id) };
    expect((await ensureGoogleWorkweekEffect(input)).state).toBe("delayed");
    expect((await service(client, () => client.query("select public.finish_team_workweek_provider_operation($1) as result", [claim.id]))).rows[0].result.state).toBe("uncertain");
    await client.query("update public.team_workweek_provider_operations set created_at=clock_timestamp()-interval '100 years' where id=$1", [claim.id]);
    expect((await ensureGoogleWorkweekEffect({ ...input, readOnly: true })).state).toBe("delayed");
    expect((await service(client, () => client.query("select public.request_team_workweek_publication_restart($1,'delayed-owner') as result", [publication.id]))).rows[0].result.reason).toBe("uncertain");
    expect(await captureDatabaseError(client, () => service(client, () => client.query("select public.prepare_team_workweek_effect_cleanup($1,1)", [publication.id])))).toMatchObject({ code: "P0003" });
    event = { ...effect.payload, etag: "late-etag" };
    expect((await ensureGoogleWorkweekEffect({ ...input, readOnly: true })).state).toBe("confirmed");
    expect((await service(client, () => client.query("select public.finish_team_workweek_provider_operation($1) as result", [claim.id]))).rows[0].result.state).toBe("settled");
    expect((await service(client, () => client.query("select public.prepare_team_workweek_effect_cleanup($1,1) as result", [publication.id]))).rows[0].result.effects.length).toBeGreaterThan(0);
  });
}, 30_000);

it.each(["ceo", "deputy", "founder", "viewer"])("keeps cancellation and provider evidence service-only for a mapped %s owner", async role => {
  await withIsolatedLocalDatabase(async client => {
    const { draft, publication } = await prepare(client, role);
    const foreign = "bfa73001-0000-4000-8000-000000000002", unmapped = "bfa73001-0000-4000-8000-000000000003";
    await client.query("insert into auth.users(id) values($1),($2)", [foreign, unmapped]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('foreign-recovery',$1,'Foreign','ceo')", [foreign]);
    for (const user of [ownerUser, foreign, unmapped]) {
      expect(await captureDatabaseError(client, () => asAuthenticated(client, user, () => client.query("select public.request_team_workweek_publication_restart($1,'delayed-owner')", [publication.id])))).toMatchObject({ code: "42501" });
      expect(await captureDatabaseError(client, () => asAuthenticated(client, user, () => client.query("select public.claim_team_workweek_provider_operation($1,1,'publish')", [publication.id])))).toMatchObject({ code: "42501" });
      expect(await captureDatabaseError(client, () => asAuthenticated(client, user, () => client.query("select * from public.team_workweek_provider_operations")))).toMatchObject({ code: "42501" });
    }
    await service(client, () => client.query("select public.request_team_workweek_publication_restart($1,'delayed-owner')", [publication.id]));
    for (const user of [foreign, unmapped]) expect(await captureDatabaseError(client, () => asAuthenticated(client, user, () => client.query("select public.restart_private_team_workweek_version($1)", [draft.id])))).toMatchObject({ code: "42501" });
    expect(await captureDatabaseError(client, () => asAuthenticated(client, ownerUser, () => client.query("select public.restart_private_team_workweek_version($1)", [draft.id])))).toMatchObject({ code: "P0003" });
  });
}, 30_000);

it.each(["future", "expired"])("does not infer that an unjournaled %s attempt has never dispatched a Google write", async timing => {
  await withIsolatedLocalDatabase(async client => {
    const { publication } = await prepare(client);
    await client.query("update public.team_workweek_publications set write_journal_version=0 where id=$1", [publication.id]);
    if (timing === "expired") await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '100 years' where id=$1", [publication.id]);
    expect((await service(client, () => client.query("select public.request_team_workweek_publication_restart($1,'delayed-owner') as result", [publication.id]))).rows[0].result).toEqual({ state: "delayed", reason: "legacy_untracked" });
    expect((await client.query("select restart_requested_at from public.team_workweek_publications where id=$1", [publication.id])).rows[0].restart_requested_at).toBeNull();
    expect(await captureDatabaseError(client, () => service(client, () => client.query("select public.prepare_team_workweek_effect_cleanup($1,1)", [publication.id])))).toMatchObject({ code: "P0003" });
  });
}, 30_000);

it("keeps a publication created by an old runtime untracked when the new runtime retries it", async () => {
  await withIsolatedLocalDatabase(async client => {
    await client.query("insert into auth.users(id) values($1)", [ownerUser]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('delayed-owner',$1,'Owner','viewer')", [ownerUser]);
    const draft = (await asAuthenticated(client, ownerUser, () => client.query("select public.create_private_team_workweek_version(date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7,'[]') as result"))).rows[0].result;
    const old = (await asAuthenticated(client, ownerUser, () => client.query("select public.prepare_team_workweek_publication($1) as result", [draft.id]))).rows[0].result;
    expect(old.writeJournalVersion).toBe(0);
    expect((await asAuthenticated(client, ownerUser, () => client.query("select public.prepare_team_workweek_publication($1,1) as result", [draft.id]))).rows[0].result.writeJournalVersion).toBe(0);
    expect((await service(client, () => client.query("select public.request_team_workweek_publication_restart($1,'delayed-owner') as result", [old.id]))).rows[0].result.reason).toBe("legacy_untracked");
  });
}, 30_000);

it("prevents an old runtime from obtaining a journaled generation for unrecorded provider writes", async () => {
  await withIsolatedLocalDatabase(async client => {
    const { draft, publication } = await prepare(client);
    expect(publication.writeJournalVersion).toBe(1);
    expect(await captureDatabaseError(client, () => asAuthenticated(client, ownerUser, () => client.query("select public.prepare_team_workweek_publication($1)", [draft.id])))).toMatchObject({ code: "P0003" });
  });
}, 30_000);

it("does not replan an expired empty generation while a publisher still owns it", async () => {
  await withIsolatedLocalDatabase(async client => {
    const { draft, publication } = await prepare(client);
    await client.query("delete from public.team_workweek_publication_effects where publication_id=$1", [publication.id]);
    await service(client, () => client.query("select public.claim_team_workweek_provider_operation($1,1,'publish')", [publication.id]));
    await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 minute',planned_effect_count=0 where id=$1", [publication.id]);
    expect(await captureDatabaseError(client, () => asAuthenticated(client, ownerUser, () => client.query("select public.prepare_team_workweek_publication($1,1)", [draft.id])))).toMatchObject({ code: "P0003" });
    expect((await client.query("select attempt_generation from public.team_workweek_publications where id=$1", [publication.id])).rows[0].attempt_generation).toBe(1);
  });
}, 30_000);

it.each(["cancellation", "finalization"])("serializes %s winning against a concurrent owner request", async winner => {
  const url = await localDatabaseUrl();
  const first = new pg.Client(url), second = new pg.Client(url);
  await first.connect(); await second.connect();
  try {
    await first.query("begin");
    const { publication } = await prepare(first);
    for (const effect of publication.effects) await service(first, () => first.query("select public.confirm_team_workweek_effect($1,1,'observed',$2)", [effect.id, effect.payload]));
    await first.query("commit");
    await first.query("begin");
    await second.query("begin");
    const secondPid = (await second.query("select pg_backend_pid() as pid")).rows[0].pid;
    if (winner === "cancellation") {
      await service(first, () => first.query("select public.request_team_workweek_publication_restart($1,'delayed-owner')", [publication.id]));
      await second.query("select set_config('request.jwt.claim.sub',$1,true)", [ownerUser]);
      await second.query("select set_config('request.jwt.claim.role','authenticated',true)");
      await second.query("set local role authenticated");
    } else {
      await asAuthenticated(first, ownerUser, () => first.query("select public.finalize_team_workweek_publication($1)", [publication.id]));
      await second.query("select set_config('request.jwt.claim.role','service_role',true)");
      await second.query("set local role service_role");
    }
    const blocked = second.query(winner === "cancellation"
      ? "select public.finalize_team_workweek_publication($1)"
      : "select public.request_team_workweek_publication_restart($1,'delayed-owner')", [publication.id]).then(() => null, error => error);
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      waiting = (await first.query("select wait_event from pg_stat_activity where pid=$1", [secondPid])).rows[0]?.wait_event === "advisory";
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await first.query("commit");
    expect(await blocked).toMatchObject({ code: "P0003" });
    await second.query("rollback");
    expect((await first.query("select status,restart_requested_at from public.team_workweek_publications where id=$1", [publication.id])).rows[0]).toMatchObject(winner === "cancellation"
      ? { status: "preparing", restart_requested_at: expect.any(Date) }
      : { status: "published", restart_requested_at: null });
  } finally {
    await first.query("rollback").catch(() => undefined);
    await second.query("rollback").catch(() => undefined);
    await first.query("reset role");
    await first.query("delete from public.team_workweek_publications where owner_profile_id='delayed-owner'");
    await first.query("delete from public.team_workweek_versions where owner_profile_id='delayed-owner'");
    await first.query("delete from public.profiles where id='delayed-owner'");
    await first.query("delete from auth.users where id=$1", [ownerUser]);
    await first.end(); await second.end();
  }
}, 30_000);
