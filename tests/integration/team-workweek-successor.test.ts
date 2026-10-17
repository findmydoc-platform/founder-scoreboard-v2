import { expect, it } from "vitest";
import { asAuthenticated, captureDatabaseError, withIsolatedLocalDatabase } from "./helpers/local-database";
import { cleanupGoogleWorkweekEffect, ensureGoogleWorkweekEffect, type PreparedWorkweekEffect } from "../../src/features/team-workweek/server/team-workweek-immediate-effects";

it("inserts a current correction before the prepared Monday without changing that successor", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    const user = "58000000-0000-4000-8000-000000000001";
    await client.query("insert into auth.users(id) values($1)", [user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('successor-owner',$1,'Owner','viewer')", [user]);
    const sources = await client.query(`insert into public.team_workweek_versions(owner_profile_id,effective_from)
      values('successor-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date-7),
      ('successor-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7) returning id,effective_from`);
    const successor = await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values($1,'successor-owner',$2,'[{"weekday":1,"startMinute":600,"endMinute":960}]','published','confirmed',clock_timestamp(),clock_timestamp(),2) returning *`, [sources.rows[1].id, sources.rows[1].effective_from]);
    const current = await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,effective_to,superseded_by_publication_id,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values($1,'successor-owner',$2,$3::date-1,$4,'[]','published','confirmed',clock_timestamp()-interval '7 days',clock_timestamp()-interval '7 days',1) returning id`, [sources.rows[0].id, sources.rows[0].effective_from, sources.rows[1].effective_from, successor.rows[0].id]);
    const futureWindow = await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,1,600,960) returning id", [sources.rows[1].id]);
    const futureSeries = await client.query(`insert into public.team_workweek_google_series(publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at)
      values($1,$2,'successor-owner','fopsfuture001','confirmed','future-etag',2,clock_timestamp()) returning *`, [successor.rows[0].id, futureWindow.rows[0].id]);
    const oldWindow = await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,7,0,1) returning id", [sources.rows[0].id]);
    const oldSeries = await client.query(`insert into public.team_workweek_google_series(publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at)
      values($1,$2,'successor-owner','fopsold001','confirmed','bounded-etag',1,clock_timestamp()) returning id`, [current.rows[0].id, oldWindow.rows[0].id]);
    const oldPayload = { id: "fopsold001", start: { dateTime: "2020-08-29T22:00:00Z", timeZone: "Europe/Berlin" },
      end: { dateTime: "2020-08-29T22:01:00Z", timeZone: "Europe/Berlin" }, recurrence: ["RRULE:FREQ=WEEKLY"],
      extendedProperties: { private: { founderopsWorkweekSeriesId: oldSeries.rows[0].id, founderopsWorkweekRevision: "1" } } };
    const retainedUntil = (await client.query("select to_char(($1::date::timestamp at time zone 'Europe/Berlin'-interval '1 second') at time zone 'UTC','YYYYMMDD\"T\"HH24MISS\"Z\"') as until", [sources.rows[1].effective_from])).rows[0].until;
    const boundedPayload = { ...oldPayload, recurrence: [`RRULE:FREQ=WEEKLY;UNTIL=${retainedUntil}`] };
    await client.query(`insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,series_id,kind,google_event_id,payload,state,confirmed_etag,observed_at)
      values($1,'successor-owner',1,$2,'weekly','fopsold001',$3,'confirmed','original-etag',clock_timestamp()-interval '14 days')`, [current.rows[0].id, oldSeries.rows[0].id, oldPayload]);
    const storedCutoff = (await client.query(`insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,series_id,kind,operation,google_event_id,payload,expected_payload,state,confirmed_etag,observed_at)
      values($1,'successor-owner',1,$2,'predecessor_cutoff','update','fopsold001',$3,$4,'confirmed','bounded-etag',clock_timestamp()-interval '7 days') returning *`, [successor.rows[0].id, oldSeries.rows[0].id, boundedPayload, oldPayload])).rows[0];
    const draft = await asAuthenticated(client, user, () => client.query("select public.create_private_current_team_workweek_version('[{\"weekday\":7,\"startMinute\":60,\"endMinute\":240}]',$1,1) as version", [current.rows[0].id]));
    const prepared = await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1,1) as publication", [draft.rows[0].version.id]));
    const publication = prepared.rows[0].publication;
    expect(publication.successorPublicationId).toBe(successor.rows[0].id);
    expect(new Date(publication.effectiveUntil).toISOString()).toBe((await client.query("select $1::date::timestamp at time zone 'Europe/Berlin' as boundary", [sources.rows[1].effective_from])).rows[0].boundary.toISOString());
    const masters = publication.effects.filter((effect: { kind: string }) => effect.kind === "weekly");
    expect(masters.length).toBeLessThanOrEqual(1);
    for (const master of masters) {
      expect(master.payload.recurrence[0]).toMatch(/;UNTIL=\d{8}T\d{6}Z$/);
      expect(new Date(master.payload.start.dateTime).getTime()).toBeLessThan(new Date(publication.effectiveUntil).getTime());
    }
    expect(publication.effects.find((effect: { kind: string }) => effect.kind === "predecessor_cutoff").expectedPayload).toEqual(boundedPayload);
    const providerEvents = new Map<string, Record<string, unknown>>([["fopsold001", { ...boundedPayload, etag: "bounded-etag" }]]);
    const writes: string[] = [];
    let loseCreateResponse = true;
    const provider = (async (input, init) => {
      const eventId = new URL(String(input)).pathname.split("/").at(-1)!;
      if (!init?.method || init.method === "GET") return providerEvents.has(eventId) ? Response.json(providerEvents.get(eventId)) : new Response(null, { status: 404 });
      const payload = JSON.parse(String(init.body));
      writes.push(`${init.method}:${payload.id}`);
      providerEvents.set(payload.id, { ...payload, etag: `etag-${writes.length}` });
      if (init.method === "POST" && loseCreateResponse) { loseCreateResponse = false; throw new Error("Lost provider response"); }
      return Response.json(providerEvents.get(payload.id));
    }) as typeof fetch;
    for (const effect of publication.effects as PreparedWorkweekEffect[]) {
      const result = await ensureGoogleWorkweekEffect({ accessToken: { request: (url, init) => fetch(url, init) }, effect, fetchImpl: provider });
      expect(result.state).toBe("confirmed");
      if (result.state !== "confirmed") throw new Error("Provider confirmation required");
      await client.query("set local role service_role");
      await client.query("select public.confirm_team_workweek_effect($1,$2,$3,$4)", [effect.id, effect.generation, result.etag, effect.payload]);
      await client.query("reset role");
    }
    await asAuthenticated(client, user, () => client.query("select public.finalize_team_workweek_publication($1)", [publication.id]));
    expect((await client.query("select * from public.team_workweek_publications where id=$1", [successor.rows[0].id])).rows[0]).toEqual(successor.rows[0]);
    const bounds = await client.query("select effective_at,effective_until,superseded_by_publication_id from public.team_workweek_publications where id=$1", [publication.id]);
    expect(bounds.rows[0].effective_until.toISOString()).toBe(new Date(publication.effectiveUntil).toISOString());
    expect(bounds.rows[0].superseded_by_publication_id).toBe(successor.rows[0].id);
    expect((await client.query("select * from public.team_workweek_google_series where id=$1", [futureSeries.rows[0].id])).rows[0]).toEqual(futureSeries.rows[0]);
    expect((await client.query("select * from public.team_workweek_publication_effects where id=$1", [storedCutoff.id])).rows[0]).toEqual(storedCutoff);
    // Advance this disposable fixture to after the first activation, preserving both sides of its boundary.
    await client.query("update public.team_workweek_publications set effective_until=clock_timestamp()-interval '1 minute' where id=$1", [current.rows[0].id]);
    await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 minute' where id=$1", [publication.id]);
    const repeatedDraft = await asAuthenticated(client, user, () => client.query("select public.create_private_current_team_workweek_version('[]',$1,3) as version", [publication.id]));
    const repeated = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1,1) as publication", [repeatedDraft.rows[0].version.id]))).rows[0].publication;
    expect(repeated.successorPublicationId).toBe(successor.rows[0].id);
    expect(repeated.effects.every((effect: { googleEventId: string }) => effect.googleEventId !== futureSeries.rows[0].google_event_id)).toBe(true);
    const cutoff = repeated.effects.find((effect: { kind: string }) => effect.kind === "predecessor_cutoff");
    if (masters.length) expect(cutoff.expectedPayload).toEqual(masters[0].payload);
    await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 minute' where id=$1", [repeated.id]);
    const expired = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1,1) as publication", [repeatedDraft.rows[0].version.id]))).rows[0].publication;
    expect(expired.attemptGeneration).toBe(1);
    await client.query("set local role service_role");
    for (const effect of expired.effects as PreparedWorkweekEffect[]) {
      const restored = await cleanupGoogleWorkweekEffect({ accessToken: { request: (url, init) => fetch(url, init) }, effect, fetchImpl: provider });
      expect(restored.state).toBe("confirmed");
      if (restored.state !== "confirmed") throw new Error("Restoration confirmation required");
      await client.query("select public.confirm_team_workweek_effect_restoration($1,$2,$3)", [effect.id, effect.generation, restored.etag]);
    }
    await client.query("reset role");
    const resumed = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1,1) as publication", [repeatedDraft.rows[0].version.id]))).rows[0].publication;
    expect(resumed.attemptGeneration).toBe(2);
    expect(new Date(resumed.effectiveAt).getTime()).toBeGreaterThan(Date.now());
    expect(resumed.successorPublicationId).toBe(successor.rows[0].id);
    for (const effect of resumed.effects as PreparedWorkweekEffect[]) {
      const result = await ensureGoogleWorkweekEffect({ accessToken: { request: (url, init) => fetch(url, init) }, effect, fetchImpl: provider });
      expect(result.state).toBe("confirmed");
      if (result.state !== "confirmed") throw new Error("Provider confirmation required");
      await client.query("set local role service_role");
      await client.query("select public.confirm_team_workweek_effect($1,$2,$3,$4)", [effect.id, effect.generation, result.etag, effect.payload]);
      await client.query("reset role");
    }
    await asAuthenticated(client, user, () => client.query("select public.finalize_team_workweek_publication($1)", [resumed.id]));
    expect((await client.query("select * from public.team_workweek_publications where id=$1", [successor.rows[0].id])).rows[0]).toEqual(successor.rows[0]);
    expect((await client.query("select * from public.team_workweek_google_series where id=$1", [futureSeries.rows[0].id])).rows[0]).toEqual(futureSeries.rows[0]);
    expect(writes.filter((write) => write.startsWith("POST:"))).toHaveLength(publication.effects.filter((effect: PreparedWorkweekEffect) => effect.operation === "create").length);
    expect(writes.some((write) => write.includes("fopsfuture001"))).toBe(false);
    const laterMonday = (await client.query("select date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+14 as day")).rows[0].day;
    const laterDraft = (await asAuthenticated(client, user, () => client.query("select public.create_private_monday_team_workweek_version($1,'[]',$2,3) as version", [laterMonday, publication.id]))).rows[0].version;
    expect(laterDraft.basePublicationId).toBe(successor.rows[0].id);
    const later = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1,1) as publication", [laterDraft.id]))).rows[0].publication;
    expect(later.predecessorPublicationId).toBe(successor.rows[0].id);
  });
}, 30_000);

it("refuses a current candidate that would reach the successor before planning any provider effects", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    const user = "58000000-0000-4000-8000-000000000003";
    await client.query("insert into auth.users(id) values($1)", [user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('boundary-owner',$1,'Boundary','ceo')", [user]);
    const oldSource = (await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('boundary-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date-7) returning id,effective_from")).rows[0];
    const old = (await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values($1,'boundary-owner',$2,'[]','published','confirmed',clock_timestamp(),clock_timestamp(),1) returning id`, [oldSource.id, oldSource.effective_from])).rows[0];
    const nextSource = (await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode,base_publication_id,base_publication_revision) values('boundary-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date,'immediate',$1,1) returning id,effective_from", [old.id])).rows[0];
    const successor = (await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision,activation_mode,effective_at)
      values($1,'boundary-owner',$2,'[]','published','confirmed',clock_timestamp(),clock_timestamp(),2,'immediate',date_trunc('minute',clock_timestamp())+interval '1 minute') returning *`, [nextSource.id, nextSource.effective_from])).rows[0];
    const draft = (await asAuthenticated(client, user, () => client.query("select public.create_private_current_team_workweek_version('[]',$1,1) as version", [old.id]))).rows[0].version;
    const refused = await captureDatabaseError(client, () => asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1,1)", [draft.id])));
    expect(refused).toMatchObject({ code: "P0004" });
    expect((await client.query("select count(*)::integer as count from public.team_workweek_publication_effects where owner_profile_id='boundary-owner'")).rows[0].count).toBe(0);
    expect((await client.query("select * from public.team_workweek_publications where id=$1", [successor.id])).rows[0]).toEqual(successor);
  });
}, 30_000);

it.each(["before preparation", "before finalization", "unchanged"])("preserves a future-only baseline and detects successor changes: %s", async (stage) => {
  await withIsolatedLocalDatabase(async (client) => {
    const user = "58000000-0000-4000-8000-000000000002";
    await client.query("insert into auth.users(id) values($1)", [user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('future-only',$1,'Owner','founder')", [user]);
    const source = await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('future-only',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+14) returning id,effective_from");
    const future = await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values($1,'future-only',$2,'[]','published','confirmed',clock_timestamp(),clock_timestamp(),1) returning id`, [source.rows[0].id, source.rows[0].effective_from]);
    const draft = (await asAuthenticated(client, user, () => client.query(`select public.create_private_immediate_team_workweek_version('[{"weekday":7,"startMinute":60,"endMinute":240}]') as version`))).rows[0].version;
    const prepared = stage !== "before preparation" ? (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1,1) as publication", [draft.id]))).rows[0].publication : null;
    if (prepared) {
      expect(prepared.predecessorPublicationId).toBeNull();
      expect(prepared.successorPublicationId).toBe(future.rows[0].id);
      expect(prepared.effects.length).toBeGreaterThan(0);
    }
    if (stage === "unchanged") {
      const before = (await client.query("select * from public.team_workweek_publications where id=$1", [future.rows[0].id])).rows[0];
      for (const effect of prepared.effects) {
        await client.query("set local role service_role");
        await client.query("select public.confirm_team_workweek_effect($1,$2,'etag',$3)", [effect.id, effect.generation, effect.payload]);
        await client.query("reset role");
      }
      const finalized = (await asAuthenticated(client, user, () => client.query("select public.finalize_team_workweek_publication($1) as publication", [prepared.id]))).rows[0].publication;
      expect(finalized.status).toBe("published");
      expect(finalized.successorPublicationId).toBe(future.rows[0].id);
      expect(finalized.effectiveUntil).toBe(prepared.effectiveUntil);
      expect((await client.query("select * from public.team_workweek_publications where id=$1", [future.rows[0].id])).rows[0]).toEqual(before);
      return;
    }
    await client.query("update public.team_workweek_publications set windows='[{\"weekday\":1,\"startMinute\":600,\"endMinute\":960}]' where id=$1", [future.rows[0].id]);
    const stale = await captureDatabaseError(client, () => asAuthenticated(client, user, () => prepared
      ? client.query("select public.finalize_team_workweek_publication($1)", [prepared.id])
      : client.query("select public.prepare_team_workweek_publication($1,1)", [draft.id])));
    expect(stale).toMatchObject({ code: "P0004" });
    if (prepared) {
      await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 minute' where id=$1", [prepared.id]);
      const cleanupOnly = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1,1) as publication", [draft.id]))).rows[0].publication;
      expect(cleanupOnly.effects).toEqual(prepared.effects);
      expect(cleanupOnly.attemptGeneration).toBe(1);
      await client.query("set local role service_role");
      for (const effect of cleanupOnly.effects) await client.query("select public.confirm_team_workweek_effect_cleanup($1,$2)", [effect.id, effect.generation]);
      await client.query("reset role");
      const noSilentReplan = await captureDatabaseError(client, () => asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1,1)", [draft.id])));
      expect(noSilentReplan).toMatchObject({ code: "P0004" });
    }
    expect((await client.query("select status from public.team_workweek_publications where id=$1", [future.rows[0].id])).rows[0].status).toBe("published");
  });
}, 30_000);
