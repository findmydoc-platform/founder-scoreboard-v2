import { expect, it } from "vitest";
import { asAuthenticated, withIsolatedLocalDatabase } from "./helpers/local-database";
import { cleanupGoogleWorkweekEffect, ensureGoogleWorkweekEffect, type PreparedWorkweekEffect } from "@/features/team-workweek/server/team-workweek-immediate-effects";

it("publishes the entered Sunday endpoints through disjoint seasonal masters and replays the same effects", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    const user = "55000000-0000-4000-8000-000000000001";
    await client.query("insert into auth.users(id) values($1)", [user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('seasonal-owner',$1,'Seasonal','viewer')", [user]);
    const draft = await asAuthenticated(client, user, () => client.query(
      "select public.create_private_team_workweek_version('2027-03-01','[{\"weekday\":7,\"startMinute\":60,\"endMinute\":240}]') as version",
    ));
    const prepare = () => asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1) as publication", [draft.rows[0].version.id]));
    const publication = (await prepare()).rows[0].publication;
    expect(publication.effects).toHaveLength(4);
    const elapsed = publication.effects.map((effect: { payload: { start: { dateTime: string }; end: { dateTime: string } } }) =>
      (Date.parse(effect.payload.end.dateTime) - Date.parse(effect.payload.start.dateTime)) / 3_600_000).sort();
    expect(elapsed).toEqual([2, 3, 3, 4]);
    // Independently interpret the emitted RFC selectors over the complete Gregorian cycle.
    const rules = publication.effects.map((effect: PreparedWorkweekEffect) => effect.payload.recurrence![0]);
    const matches = (rule: string, date: Date) => {
      const fields = Object.fromEntries(rule.replace("RRULE:", "").split(";").map((field: string) => field.split("=")));
      const month = date.getUTCMonth() + 1;
      if (fields.BYMONTH && !fields.BYMONTH.split(",").map(Number).includes(month)) return false;
      const lastDay = new Date(Date.UTC(date.getUTCFullYear(), month, 0)).getUTCDate();
      if (fields.BYDAY === "-1SU") return date.getUTCDate() + 7 > lastDay;
      if (fields.BYSETPOS) {
        const firstSunday = date.getUTCDate() % 7 || 7;
        const position = Math.floor((date.getUTCDate() - firstSunday) / 7) + 1;
        const count = Math.floor((lastDay - firstSunday) / 7) + 1;
        return fields.BYSETPOS.split(",").map(Number).some((index: number) => (index > 0 ? index : count + index + 1) === position);
      }
      return true;
    };
    let sundays = 0;
    for (let date = new Date("2027-01-01T00:00:00Z"); date.getUTCFullYear() < 2427; date = new Date(date.getTime() + 86_400_000)) {
      if (date.getUTCDay() !== 0) continue;
      expect(rules.filter((rule: string) => matches(rule, date))).toHaveLength(1);
      sundays++;
    }
    expect(sundays).toBe(20871);
    expect((await prepare()).rows[0].publication.effects).toEqual(publication.effects);
    for (const effect of publication.effects) {
      await client.query("set local role service_role");
      await client.query("select public.confirm_team_workweek_effect($1,$2,'confirmed-etag',$3)", [effect.id, effect.generation, effect.payload]);
      await client.query("reset role");
    }
    const result = await asAuthenticated(client, user, () => client.query("select public.finalize_team_workweek_publication($1) as publication", [publication.id]));
    expect(result.rows[0].publication.status).toBe("published");
  });
}, 30_000);

it("keeps source windows while merging spring duplicates and omitting nonpositive intervals", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    const user = "55000000-0000-4000-8000-000000000002";
    await client.query("insert into auth.users(id) values($1)", [user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('gap-owner',$1,'Gap','founder')", [user]);
    const draft = await asAuthenticated(client, user, () => client.query(
      "select public.create_private_team_workweek_version('2027-03-01','[{\"weekday\":7,\"startMinute\":120,\"endMinute\":150},{\"weekday\":7,\"startMinute\":150,\"endMinute\":180},{\"weekday\":7,\"startMinute\":180,\"endMinute\":210}]') as version",
    ));
    const publication = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1) as publication", [draft.rows[0].version.id]))).rows[0].publication;
    expect(publication.effects).toHaveLength(10);
    const spring = publication.effects.filter((effect: { payload: { extendedProperties: { private: Record<string, string> } } }) => effect.payload.extendedProperties.private.founderopsWorkweekProjectionPart === "spring");
    expect(spring).toHaveLength(1);
    expect(new Date(spring[0].payload.start.dateTime).toISOString()).toBe("2027-03-28T01:00:00.000Z");
    expect(new Date(spring[0].payload.end.dateTime).toISOString()).toBe("2027-03-28T01:30:00.000Z");
    expect(spring[0].payload.extendedProperties.private.founderopsWorkweekSources.split(",")).toHaveLength(2);
    const autumn = publication.effects.find((effect: { payload: { extendedProperties: { private: Record<string, string> }; start: { dateTime: string } } }) => effect.payload.extendedProperties.private.founderopsWorkweekProjectionPart === "autumn" && new Date(effect.payload.start.dateTime).toISOString() === "2027-10-31T00:00:00.000Z");
    expect(autumn).toBeDefined();
    const effect = spring[0] as PreparedWorkweekEffect;
    let observed: unknown = null;
    const writes: string[] = [];
    const provider = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        writes.push(String(init.body));
        observed = { ...effect.payload, etag: "spring-etag" };
        throw new Error("Lost provider response");
      }
      return observed ? Response.json(observed) : new Response(null, { status: 404 });
    }) as typeof fetch;
    expect((await ensureGoogleWorkweekEffect({ accessToken: { request: (url, init) => fetch(url, init) }, effect, fetchImpl: provider })).state).toBe("confirmed");
    expect((await ensureGoogleWorkweekEffect({ accessToken: { request: (url, init) => fetch(url, init) }, effect, fetchImpl: provider })).state).toBe("confirmed");
    expect(writes).toEqual([JSON.stringify(effect.payload)]);
    const foreign = { ...effect.payload, etag: "foreign-etag", end: { ...effect.payload.end, dateTime: "2027-03-28T02:00:00Z" } };
    const methods: string[] = [];
    const cleanup = await cleanupGoogleWorkweekEffect({ accessToken: { request: (url, init) => fetch(url, init) }, effect, fetchImpl: (async (_input, init) => {
      methods.push(init?.method || "GET");
      return Response.json(foreign);
    }) as typeof fetch });
    expect(cleanup).toMatchObject({ state: "delayed", errorClass: "provider_identity_mismatch" });
    expect(methods).toEqual(["GET"]);
  });
}, 30_000);

it("clips the autumn activation remainder and starts each full cohort on its own matching date", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    const user = "55000000-0000-4000-8000-000000000003";
    await client.query("insert into auth.users(id) values($1)", [user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('fold-owner',$1,'Fold','deputy')", [user]);
    const draft = await asAuthenticated(client, user, () => client.query("select public.create_private_immediate_team_workweek_version('[{\"weekday\":7,\"startMinute\":60,\"endMinute\":240}]') as version"));
    await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,publication_revision,activation_mode,effective_at,attempt_generation)
      select id,owner_profile_id,effective_from,'[{"weekday":7,"startMinute":60,"endMinute":240}]',1,'immediate','2027-10-31T01:30:00Z',1 from public.team_workweek_versions where id=$1`, [draft.rows[0].version.id]);
    const publication = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1) as publication", [draft.rows[0].version.id]))).rows[0].publication;
    expect(publication.effects).toHaveLength(5);
    const remainder = publication.effects.find((effect: { kind: string }) => effect.kind === "activation_remainder");
    expect(new Date(remainder.payload.start.dateTime).toISOString()).toBe("2027-10-31T01:30:00.000Z");
    expect(new Date(remainder.payload.end.dateTime).toISOString()).toBe("2027-10-31T03:00:00.000Z");
    const autumn = publication.effects.find((effect: { payload: { extendedProperties: { private: Record<string, string> } } }) => effect.payload.extendedProperties.private.founderopsWorkweekProjectionPart === "autumn");
    expect(new Date(autumn.payload.start.dateTime).toISOString()).toBe("2028-10-28T23:00:00.000Z");
    for (const effect of publication.effects.slice(1)) {
      await client.query("set local role service_role");
      await client.query("select public.confirm_team_workweek_effect($1,$2,'etag',$3)", [effect.id, effect.generation, effect.payload]);
      await client.query("reset role");
    }
    await client.query("delete from public.team_workweek_publication_effects where id=$1", [publication.effects[0].id]);
    await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1)", [draft.rows[0].version.id]));
    await client.query("savepoint missing_effect");
    await expect(asAuthenticated(client, user, () => client.query("select public.finalize_team_workweek_publication($1)", [publication.id]))).rejects.toMatchObject({ code: "P0003" });
    await client.query("rollback to savepoint missing_effect");
  });
}, 30_000);

it("cuts off every stored seasonal rule and binds a crossing occurrence only to the matching autumn cohort", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    const user = "55000000-0000-4000-8000-000000000004";
    const owner = "cohort-replacement";
    await client.query("insert into auth.users(id) values($1)", [user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Cohort','ceo')", [owner, user]);
    const draft = await asAuthenticated(client, user, () => client.query("select public.create_private_immediate_team_workweek_version('[{\"weekday\":7,\"startMinute\":60,\"endMinute\":240}]') as version"));
    const old = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1) as publication", [draft.rows[0].version.id]))).rows[0].publication;
    for (const effect of old.effects) {
      await client.query("set local role service_role");
      await client.query("select public.confirm_team_workweek_effect($1,$2,'original-etag',$3)", [effect.id, effect.generation, effect.payload]);
      await client.query("reset role");
    }
    await asAuthenticated(client, user, () => client.query("select public.finalize_team_workweek_publication($1)", [old.id]));
    // Controlled database clock fixture: the retained plan is already active.
    await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 minute' where id=$1", [old.id]);
    const replacement = await asAuthenticated(client, user, () => client.query("select public.create_private_current_team_workweek_version('[]',$1,1) as version", [old.id]));
    await client.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,publication_revision,activation_mode,effective_at,attempt_generation,predecessor_publication_id,expected_predecessor_revision)
      select id,owner_profile_id,effective_from,'[]',2,'immediate','2027-10-31T01:30:00Z',1,$2,1 from public.team_workweek_versions where id=$1`, [replacement.rows[0].version.id, old.id]);
    const prepared = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1) as publication", [replacement.rows[0].version.id]))).rows[0].publication;
    const cutoffs = prepared.effects.filter((effect: { kind: string }) => effect.kind === "predecessor_cutoff");
    expect(cutoffs).toHaveLength(4);
    for (const cutoff of cutoffs) {
      expect(cutoff.operation).toBe("update");
      expect(cutoff.payload.recurrence).toEqual([`${cutoff.expectedPayload.recurrence[0]};UNTIL=20271031T012959Z`]);
    }
    const crossing = prepared.effects.filter((effect: { kind: string }) => effect.kind === "crossing_instance");
    expect(crossing).toHaveLength(1);
    expect(crossing[0].expectedPayload.extendedProperties.private.founderopsWorkweekProjectionPart).toBe("autumn");
    expect(new Date(crossing[0].originalStart).toISOString()).toBe("2027-10-30T23:00:00.000Z");
    expect(new Date(crossing[0].payload.end.dateTime).toISOString()).toBe("2027-10-31T01:30:00.000Z");
  });
}, 30_000);

it("cancels cohorts with no occurrence before replacement instead of manufacturing a zero COUNT", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    const user = "55000000-0000-4000-8000-000000000005";
    const owner = "future-cohort-replacement";
    await client.query("insert into auth.users(id) values($1)", [user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,'Future cohorts','viewer')", [owner, user]);
    const draft = await asAuthenticated(client, user, () => client.query("select public.create_private_team_workweek_version('2027-03-01','[{\"weekday\":7,\"startMinute\":60,\"endMinute\":240}]') as version"));
    const old = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1) as publication", [draft.rows[0].version.id]))).rows[0].publication;
    for (const effect of old.effects) {
      await client.query("set local role service_role");
      await client.query("select public.confirm_team_workweek_effect($1,$2,'original-etag',$3)", [effect.id, effect.generation, effect.payload]);
      await client.query("reset role");
    }
    await asAuthenticated(client, user, () => client.query("select public.finalize_team_workweek_publication($1)", [old.id]));
    await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 minute' where id=$1", [old.id]);
    const replacement = await asAuthenticated(client, user, () => client.query("select public.create_private_current_team_workweek_version('[]',$1,1) as version", [old.id]));
    const prepared = (await asAuthenticated(client, user, () => client.query("select public.prepare_team_workweek_publication($1) as publication", [replacement.rows[0].version.id]))).rows[0].publication;
    expect(prepared.effects).toHaveLength(4);
    for (const effect of prepared.effects) {
      expect(effect).toMatchObject({ operation: "cancel", kind: "predecessor_cutoff", payload: { status: "cancelled" } });
      expect(effect.payload.recurrence).toEqual(effect.expectedPayload.recurrence);
    }
  });
}, 30_000);
