import { asService, confirmObservedCleanup, confirmObservedEffect } from "./helpers/workweek-provider";
import { expect, it } from "vitest";
import {
  asAuthenticated,
  captureDatabaseError,
  withIsolatedLocalDatabase,
} from "./helpers/local-database";

const members = [
  { id: "integration-ceo", role: "ceo", authUserId: "50000000-0000-0000-0000-000000000001" },
  { id: "integration-founder", role: "founder", authUserId: "50000000-0000-0000-0000-000000000002" },
  { id: "integration-deputy", role: "deputy", authUserId: "50000000-0000-0000-0000-000000000003" },
  { id: "integration-viewer", role: "viewer", authUserId: "50000000-0000-0000-0000-000000000004" },
] as const;
const unmappedAuthUserId = "50000000-0000-0000-0000-000000000099";

it("lets every mapped role manage only its private workweek", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await client.query(
      "insert into auth.users (id) select unnest($1::uuid[])",
      [[...members.map(({ authUserId }) => authUserId), unmappedAuthUserId]],
    );
    for (const member of members) {
      await client.query(
        `insert into public.profiles (id, auth_user_id, name, platform_role)
         values ($1, $2, $3, $4)`,
        [member.id, member.authUserId, `Integration ${member.role}`, member.role],
      );
    }

    const dateResult = await client.query(`
      select (
        date_trunc('week', clock_timestamp() at time zone 'Europe/Berlin')::date + 28
      ) as next_monday
    `);
    const nextMonday = dateResult.rows[0].next_monday;

    for (const [index, member] of members.entries()) {
      const effectiveDate = await client.query(
        "select ($1::date + ($2::integer * 7))::text as value",
        [nextMonday, index],
      );
      await asAuthenticated(client, member.authUserId, async () => {
        const created = await client.query(
          `select public.create_private_team_workweek_version(
             $1,
             '[{"weekday":3,"startMinute":540,"endMinute":1020}]'::jsonb
           ) as version`,
          [effectiveDate.rows[0].value],
        );
        expect(created.rows[0].version.status).toBe("preparing");

        const visible = await client.query(
          "select owner_profile_id from public.team_workweek_versions order by owner_profile_id",
        );
        expect(visible.rows.length).toBeGreaterThanOrEqual(1);
        expect(visible.rows.every((row) => row.owner_profile_id === member.id)).toBe(true);
      });
    }

    const unmappedError = await captureDatabaseError(client, () => asAuthenticated(client, unmappedAuthUserId, () => client.query(
      "select public.create_private_team_workweek_version($1, '[]'::jsonb)",
      [nextMonday],
    )));
    expect(unmappedError).toMatchObject({
      code: "42501",
      message: expect.stringMatching(/mapped team profile required/),
    });

    const directInsertError = await captureDatabaseError(client, () => asAuthenticated(client, members[3].authUserId, () => client.query(
      `insert into public.team_workweek_versions (owner_profile_id, effective_from)
       values ($1, $2)`,
      [members[3].id, nextMonday],
    )));
    expect(directInsertError).toMatchObject({ code: "42501" });
  });
}, 30_000);


it("publishes first immediate workweeks only after service confirmation for every mapped owner", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await client.query("insert into auth.users (id) select unnest($1::uuid[])", [[...members.map(({ authUserId }) => authUserId), unmappedAuthUserId]]);
    for (const member of members) await client.query("insert into public.profiles (id,auth_user_id,name,platform_role) values ($1,$2,$3,$4)", [member.id,member.authUserId,member.role,member.role]);
    for (const member of members) {
      const created = await asAuthenticated(client, member.authUserId, () => client.query("select public.create_private_immediate_team_workweek_version('[{\"weekday\":3,\"startMinute\":0,\"endMinute\":1439}]') as version"));
      expect(created.rows[0].version.activationMode).toBe("immediate");
      const prepared = await asAuthenticated(client, member.authUserId, () => client.query("select public.prepare_team_workweek_publication($1,1) as publication", [created.rows[0].version.id]));
      const publication = prepared.rows[0].publication;
      expect(new Date(publication.effectiveAt).getTime()).toBeGreaterThan(Date.now());
      expect(publication.attemptGeneration).toBe(1);
      expect(publication.effects.length).toBeGreaterThan(0);
      const pending = await captureDatabaseError(client, () => asAuthenticated(client, member.authUserId, () => client.query("select public.finalize_team_workweek_publication($1)", [publication.id])));
      expect(pending).toMatchObject({code:"P0003"});
      for (const effect of publication.effects) {
        expect(new Date(effect.payload.start.dateTime).getTime()).toBeGreaterThanOrEqual(new Date(publication.effectiveAt).getTime());
        const forged = await captureDatabaseError(client, () => asAuthenticated(client, member.authUserId, () => client.query("select public.confirm_team_workweek_effect($1,$2,$3,$4)", [effect.id,1,'\"etag\"',effect.payload])));
        expect(forged).toMatchObject({code:"42501"});
        await client.query("set local role service_role");
        await confirmObservedEffect(client, effect.id, 1, '\"etag\"', effect.payload);
        await client.query("reset role");
      }
      const confirmed = await asAuthenticated(client,member.authUserId,()=>client.query("select public.finalize_team_workweek_publication($1) as publication",[publication.id]));
      expect(confirmed.rows[0].publication).toMatchObject({status:"published",effectiveAt:publication.effectiveAt});
      const replay = await asAuthenticated(client,member.authUserId,()=>client.query("select public.finalize_team_workweek_publication($1) as publication",[publication.id]));
      expect(replay.rows[0].publication).toEqual(confirmed.rows[0].publication);
      const replacement = await captureDatabaseError(client, () => asAuthenticated(client,member.authUserId,()=>client.query("select public.create_private_immediate_team_workweek_version('[]')")));
      expect(replacement).toMatchObject({code:"22023"});
    }
    const unmapped = await captureDatabaseError(client,()=>asAuthenticated(client,unmappedAuthUserId,()=>client.query("select public.create_private_immediate_team_workweek_version('[]')")));
    expect(unmapped).toMatchObject({code:"42501"});
  });
},30_000);


it("expired attempts require observed cleanup and a new generation, never retrospective finalization", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await client.query("insert into auth.users (id) select unnest($1::uuid[])", [[members[0].authUserId,members[3].authUserId]]);
    for (const member of [members[0],members[3]]) await client.query("insert into public.profiles (id,auth_user_id,name,platform_role) values ($1,$2,$3,$4)",[member.id,member.authUserId,member.role,member.role]);
    const owner=members[0].authUserId;
    const created=await asAuthenticated(client,owner,()=>client.query("select public.create_private_immediate_team_workweek_version('[{\"weekday\":6,\"startMinute\":540,\"endMinute\":1020}]') as version"));
    const id=created.rows[0].version.id;
    const prepared=await asAuthenticated(client,owner,()=>client.query("select public.prepare_team_workweek_publication($1,1) as publication",[id]));
    const first=prepared.rows[0].publication;
    const foreign=await captureDatabaseError(client,()=>asAuthenticated(client,members[3].authUserId,()=>client.query("select public.finalize_team_workweek_publication($1)",[first.id])));
    expect(foreign).toMatchObject({code:"P0002"});
    const privateEffects=await asAuthenticated(client,members[3].authUserId,()=>client.query("select id from public.team_workweek_publication_effects"));
    expect(privateEffects.rowCount).toBe(0);
    await client.query("update public.team_workweek_publications set effective_at=clock_timestamp()-interval '1 minute' where id=$1",[first.id]);
    const expired=await captureDatabaseError(client,()=>asAuthenticated(client,owner,()=>client.query("select public.finalize_team_workweek_publication($1)",[first.id])));
    expect(expired).toMatchObject({code:"P0005"});
    const notReplanned=await asAuthenticated(client,owner,()=>client.query("select public.prepare_team_workweek_publication($1,1) as publication",[id]));
    expect(notReplanned.rows[0].publication.attemptGeneration).toBe(1);
    await client.query("set local role service_role");
    const cleanupPlan=(await asService(client,()=>client.query("select public.prepare_team_workweek_effect_cleanup($1,1) as value",[first.id]))).rows[0].value;
      for(const effect of cleanupPlan.effects) if(effect.state!=="cleaned") await confirmObservedCleanup(client,effect.id,effect.generation,"absent",false);
    await client.query("reset role");
    const replanned=await asAuthenticated(client,owner,()=>client.query("select public.prepare_team_workweek_publication($1,1) as publication",[id]));
    const next=replanned.rows[0].publication;
    expect(next.attemptGeneration).toBe(2);
    expect(new Date(next.effectiveAt).getTime()).toBeGreaterThan(Date.now());
    expect(next.effects[0].googleEventId).not.toBe(first.effects[0].googleEventId);
    const stale=await captureDatabaseError(client,()=>asService(client,()=>client.query("select public.confirm_team_workweek_effect($1,1,'etag',$2)",[first.effects[0].id,first.effects[0].payload])));
    expect(stale).toMatchObject({code:"P0003"});
    const direct=await captureDatabaseError(client,()=>asAuthenticated(client,owner,()=>client.query("update public.team_workweek_publications set effective_at=clock_timestamp() where id=$1",[first.id])));
    expect(direct).toMatchObject({code:"42501"});
  });
},30_000);
