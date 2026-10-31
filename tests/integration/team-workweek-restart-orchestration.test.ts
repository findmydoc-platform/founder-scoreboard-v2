import { localCalendar, observeEffect } from "./helpers/workweek-provider";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import pg from "pg";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { restartPrivateTeamWorkweek } from "../../src/features/team-workweek/server/team-workweek-restart";
import { ensureGoogleWorkweekEffect, type PreparedWorkweekEffect } from "../../src/features/team-workweek/server/team-workweek-immediate-effects";
import { providerWriteJournal } from "../../src/features/team-workweek/server/team-workweek-provider-operations";

const nativeFetch = globalThis.fetch;
afterEach(() => vi.unstubAllGlobals());

async function rpc(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const result = await client.rpc(name, args);
  if (result.error)
    throw new Error(`${name}: ${result.error.code} ${result.error.message}`);
  return result.data;
}

async function fixture() {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const status = JSON.parse(stdout);
  if (!['127.0.0.1', 'localhost'].includes(new URL(status.API_URL).hostname))
    throw new Error("Disposable local Supabase required");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  const service = createClient(status.API_URL, status.SERVICE_ROLE_KEY, options);
  const user = createClient(status.API_URL, status.ANON_KEY, options);
  const id = randomUUID(), owner = `restart-${id}`;
  const email = `${id}@example.test`, password = `test-${randomUUID()}`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user)
    throw new Error("Could not create local test owner");
  const profile = await service.from('profiles').insert({ id: owner, auth_user_id: created.data.user.id, name: 'Restart owner', platform_role: 'viewer' });
  if (profile.error)
    throw profile.error;
  const signedIn = await user.auth.signInWithPassword({ email, password });
  if (signedIn.error)
    throw signedIn.error;
  const db = new pg.Client(status.DB_URL);
  await db.connect();
  const weeks = (await db.query("select (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::text as first, (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+14)::text as other, (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+21)::text as later")).rows[0];
  const save = async (week: string, windows: unknown) => {
    const context = await rpc(user, 'team_workweek_edit_context', { p_week_start: week });
    return rpc(user, 'create_private_selected_team_workweek_version', { p_week_start: week, p_windows: windows, p_context_token: context.contextToken });
  };
  const prepare = (version: {
    id: string;
  }) => rpc(user, 'prepare_team_workweek_publication', { p_version_id: version.id, p_write_journal_version: 1 });
  const confirm = async (effect: PreparedWorkweekEffect, etag: string) => {
    await observeEffect(db,effect.id);
    return rpc(service,'confirm_team_workweek_effect',{p_effect_id:effect.id,p_generation:1,p_etag:etag,p_payload:effect.payload});
  };
  // Establish confirmed plans through owner and service RPCs; recovery below uses the application boundary.
  const first = await prepare(await save(weeks.first, [{ weekday: 1, startMinute: 540, endMinute: 960 }]));
  for (const effect of first.effects)
    await confirm(effect, 'baseline-etag');
  await rpc(user, 'finalize_team_workweek_publication', { p_publication_id: first.id });
  const later = await prepare(await save(weeks.later, []));
  for (const effect of later.effects)
    await confirm(effect, 'baseline-etag');
  await rpc(user, 'finalize_team_workweek_publication', { p_publication_id: later.id });
  const retained = await save(weeks.other, [{ weekday: 5, startMinute: 660, endMinute: 840 }]);
  const draft = await save(weeks.first, [{ weekday: 2, startMinute: 600, endMinute: 900 }]);
  const publication = await prepare(draft);
  const predecessor = publication.effects.find((effect: PreparedWorkweekEffect) => effect.operation !== "create") as PreparedWorkweekEffect;
  expect(predecessor).toBeTruthy();
  const before = (await db.query('select * from public.team_workweek_publications where id=any($1::uuid[]) order by id', [[first.id, later.id]])).rows;
  const mappings = (await db.query('select * from public.team_workweek_google_series where publication_id=$1', [first.id])).rows;
  const restart = () => restartPrivateTeamWorkweek({ ownerProfileId: owner, versionId: draft.id, userSupabase: user, serviceSupabase: service, accessTokenForOwner: async () => (localCalendar(db)) });
  const checkPreserved = async () => {
    expect((await db.query('select * from public.team_workweek_publications where id=any($1::uuid[]) order by id', [[first.id, later.id]])).rows).toEqual(before);
    expect((await db.query('select * from public.team_workweek_google_series where publication_id=$1', [first.id])).rows).toEqual(mappings);
    const context = await rpc(user, 'team_workweek_edit_context', { p_week_start: weeks.other });
    expect(context.weekStart).toBe(weeks.other);
    const saved = await user.from('team_workweek_versions').select('effective_from,team_workweek_windows(weekday,start_minute,end_minute)').eq('id', retained.id).single();
    expect(saved.error).toBeNull();
    expect(saved.data).toEqual({ effective_from: weeks.other, team_workweek_windows: [{ weekday: 5, start_minute: 660, end_minute: 840 }] });
    const retainedPublication = await service.from('team_workweek_publications').select('id').eq('source_version_id', retained.id);
    expect(retainedPublication.data).toEqual([]);
  };
  const cleanup = async () => {
    await db.query('delete from public.team_workweek_provider_operations where owner_profile_id=$1', [owner]);
    await db.query('delete from public.profiles where id=$1', [owner]);
    await service.auth.admin.deleteUser(created.data.user.id);
    await db.end();
  };
  return { service, user, db, owner, weeks, first, later, draft, publication, predecessor, confirm, restart, checkPreserved, cleanup };
}

function scriptedGoogle() {
  const events = new Map<string, Record<string, unknown>>();
  const writes: Array<{
    method: string;
    id: string;
    status?: string;
  }> = [];
  let post: ((payload: Record<string, unknown>) => Promise<Response>) | undefined;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname !== 'www.googleapis.com')
      return nativeFetch(input, init);
    const id = url.pathname.split('/').at(-1)!;
    const method = init?.method || 'GET';
    if (method === 'GET')
      return events.has(id) ? Response.json(events.get(id)) : new Response(null, { status: 404 });
    if (method === 'POST') {
      const payload = JSON.parse(String(init?.body));
      writes.push({ method, id: payload.id, status: payload.status });
      if (post)
        return post(payload);
      const event = { ...payload, etag: 'provisional-etag' };
      events.set(payload.id, event);
      return Response.json(event);
    }
    writes.push({ method, id });
    if (method === 'DELETE') {
      events.delete(id);
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected Google mutation: ${method}`);
  });
  return { events, writes, onPost: (handler: typeof post) => { post = handler; } };
}

it.each([false, true])('restarts the actual replacement workflow after an external predecessor change (deleted=%s)', async (deleted) => {
  const scenario = await fixture();
  const google = scriptedGoogle();
  try {
    const baseline = scenario.predecessor.expectedPayload!;
    const external = { ...baseline, etag: 'external-etag',
      start: { ...baseline.start, dateTime: new Date(Date.parse(baseline.start.dateTime) + 3600000).toISOString() },
      end: { ...baseline.end, dateTime: new Date(Date.parse(baseline.end.dateTime) + 3600000).toISOString() } };
    if (!deleted)
      google.events.set(scenario.predecessor.googleEventId, external);
    const claim = await rpc(scenario.service, 'claim_team_workweek_provider_operation', { p_publication_id: scenario.publication.id, p_generation: 1, p_purpose: 'publish' });
    for (const effect of scenario.publication.effects.filter((item: PreparedWorkweekEffect) => item.operation === 'create')) {
      const result = await ensureGoogleWorkweekEffect({ accessToken: localCalendar(scenario.db), effect, writeJournal: providerWriteJournal(scenario.service, claim.id, effect.id) });
      expect(result.state).toBe('confirmed');
      if (result.state === 'confirmed')
        await scenario.confirm(effect, result.etag);
    }
    expect(await ensureGoogleWorkweekEffect({ accessToken: localCalendar(scenario.db), effect: scenario.predecessor, writeJournal: providerWriteJournal(scenario.service, claim.id, scenario.predecessor.id) })).toMatchObject({ state: 'delayed', errorClass: 'provider_identity_mismatch' });
    await rpc(scenario.service, 'finish_team_workweek_provider_operation', { p_operation_id: claim.id });
    const result = await scenario.restart();
    expect(result.restart).toEqual({ state: 'ready', recovery: null });
    expect(result.version).toMatchObject({ effectiveFrom: scenario.weeks.first, basePublicationId: scenario.first.id, status: 'preparing' });
    expect(result.version?.windows.tuesday).toEqual([{ start: "10:00", end: "15:00" }]);
    expect(google.events.get(scenario.predecessor.googleEventId)).toEqual(deleted ? undefined : external);
    expect(google.writes.filter(write => write.id === scenario.predecessor.googleEventId)).toEqual([]);
    expect(google.writes.filter(write => write.method === 'POST' && write.status !== 'cancelled')).toHaveLength(1);
    expect(google.writes.filter(write => write.method === 'DELETE')).toHaveLength(1);
    expect((await scenario.service.from('team_workweek_publication_effects').select('state,cleanup_skipped,cleanup_confirmed_etag,observed_at').eq('id', scenario.predecessor.id).single()).data).toEqual({ state: 'cleaned', cleanup_skipped: true, cleanup_confirmed_etag: null, observed_at: null });
    const writesAfterRecovery = [...google.writes];
    expect((await scenario.restart()).version?.id).toBe(result.version?.id);
    expect(google.writes).toEqual(writesAfterRecovery);
    await scenario.checkPreserved();
  }
  finally {
    await scenario.cleanup();
  }
}, 30000);

it.each(['outstanding', 'uncertain'])('keeps an %s Google write blocked until its controlled late response is observed', async (state) => {
  const scenario = await fixture();
  const google = scriptedGoogle();
  try {
    google.events.set(scenario.predecessor.googleEventId, { ...scenario.predecessor.expectedPayload, etag: 'baseline-etag' });
    const effect = scenario.publication.effects.find((item: PreparedWorkweekEffect) => item.operation === 'create') as PreparedWorkweekEffect;
    const claim = await rpc(scenario.service, 'claim_team_workweek_provider_operation', { p_publication_id: scenario.publication.id, p_generation: 1, p_purpose: 'publish' });
    let release!: () => void, started!: () => void;
    const dispatched = new Promise<void>(resolve => { started = resolve; });
    google.onPost(async (payload) => {
      // A lost cancellation response cannot turn a 404 or elapsed time into proof.
      if (payload.status === 'cancelled')
        throw new DOMException('Cancellation response lost', 'TimeoutError');
      started();
      if (state === 'uncertain')
        throw new DOMException('Response lost', 'TimeoutError');
      return new Promise<Response>(resolve => { release = () => { const event = { ...payload, etag: 'late-etag' }; google.events.set(payload.id as string, event); resolve(Response.json(event)); }; });
    });
    const writing = ensureGoogleWorkweekEffect({ accessToken: localCalendar(scenario.db), effect, writeJournal: providerWriteJournal(scenario.service, claim.id, effect.id) });
    await dispatched;
    if (state === 'outstanding')
      expect((await scenario.restart()).restart).toMatchObject({ state: 'delayed', reason: 'in_progress' });
    else {
      expect((await writing).state).toBe('delayed');
      await rpc(scenario.service, 'finish_team_workweek_provider_operation', { p_operation_id: claim.id });
    }
    await scenario.db.query("update public.team_workweek_provider_operations set created_at=clock_timestamp()-interval '100 years' where id=$1", [claim.id]);
    expect((await scenario.restart()).restart).toMatchObject({ state: 'delayed', reason: 'uncertain' });
    expect((await scenario.service.rpc('record_team_workweek_provider_write', { p_operation_id: claim.id, p_effect_id: effect.id, p_state: 'dispatched' })).error).toMatchObject({ code: 'P0003' });
    if (state === 'outstanding') {
      release();
      expect((await writing).state).toBe('confirmed');
    }
    else
      google.events.set(effect.googleEventId, { ...effect.payload, etag: 'late-etag' });
    expect((await scenario.service.rpc('confirm_team_workweek_effect', { p_effect_id: effect.id, p_generation: 1, p_etag: 'late-etag', p_payload: effect.payload })).error).toMatchObject({ code: 'P0003' });
    const result = await scenario.restart();
    expect(result.restart).toEqual({ state: 'ready', recovery: null });
    expect(google.events.has(effect.googleEventId)).toBe(false);
    expect(google.writes.filter(write => write.method === 'POST' && write.status !== 'cancelled')).toHaveLength(1);
    expect(google.writes.filter(write => write.id === scenario.predecessor.googleEventId)).toEqual([]);
    const writesAfterRecovery = [...google.writes];
    expect((await scenario.restart()).version?.id).toBe(result.version?.id);
    expect(google.writes).toEqual(writesAfterRecovery);
    await scenario.checkPreserved();
  }
  finally {
    await scenario.cleanup();
  }
}, 30000);
