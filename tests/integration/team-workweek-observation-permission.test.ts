import { expect, it } from "vitest";
import { asAuthenticated, captureDatabaseError, withIsolatedLocalDatabase } from "./helpers/local-database";
import { verifyDatabaseSecurity } from "../../scripts/lib/database-security.mjs";

it("lets the server confirm unchanged Google times before the owner's next publication", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    const owner = "61000000-0000-4000-8000-000000000001";
    await client.query("insert into auth.users(id) values($1)", [owner]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('observation-owner',$1,'Owner','founder')", [owner]);
    const monday = (await client.query("select (date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date+7)::text as value")).rows[0].value;
    const version = (await asAuthenticated(client, owner, () => client.query(
      "select public.create_private_team_workweek_version($1,'[{\"weekday\":1,\"startMinute\":540,\"endMinute\":960}]') as value", [monday],
    ))).rows[0].value;
    const publication = (await asAuthenticated(client, owner, () => client.query(
      "select public.prepare_team_workweek_publication($1,1) as value", [version.id],
    ))).rows[0].value;
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");
    await client.query("set local role service_role");
    for (const effect of publication.effects) {
      await client.query("select public.confirm_team_workweek_effect($1,$2,'confirmed-etag',$3)", [effect.id, effect.generation, effect.payload]);
    }
    await client.query("reset role");
    await asAuthenticated(client, owner, () => client.query("select public.finalize_team_workweek_publication($1)", [publication.id]));
    const observations = (await client.query(
      `select id as "seriesId", confirmed_etag as "priorEtag", confirmed_etag as "observedEtag",
         confirmed_founderops_revision as "founderopsRevision", provider_state as "providerState"
       from public.team_workweek_google_series where publication_id=$1 and state='confirmed' and provider_state='active'`,
      [publication.id],
    )).rows;
    expect(observations.length).toBeGreaterThan(0);
    await client.query("select set_config('request.jwt.claim.role','service_role',true)");
    await client.query("set local role service_role");
    const before = (await client.query("select * from public.team_workweek_publications where id=$1", [publication.id])).rows;
    const observedAt = new Date().toISOString();
    await expect(client.query(
      "select public.apply_google_team_workweek_observations($1,$2,$3,$4)",
      [publication.id, publication.publicationRevision, JSON.stringify(observations), observedAt],
    )).resolves.toBeDefined();
    await client.query("reset role");
    expect((await client.query("select * from public.team_workweek_publications where id=$1", [publication.id])).rows).toEqual(before);
    const confirmed = (await client.query("select last_observed_at from public.team_workweek_google_series where publication_id=$1", [publication.id])).rows;
    expect(confirmed.map((row) => row.last_observed_at.toISOString())).toEqual(observations.map(() => observedAt));
  });
}, 30_000);

it("denies direct Google confirmation to anonymous, mapped and unmapped user sessions", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    const roles = ["ceo", "founder", "deputy", "viewer"];
    for (const [index, role] of roles.entries()) {
      const user = `62000000-0000-4000-8000-00000000000${index + 1}`;
      await client.query("insert into auth.users(id) values($1)", [user]);
      await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values($1,$2,$1,$3)", [`observation-${role}`, user, role]);
      const error = await captureDatabaseError(client, () => asAuthenticated(client, user, () => client.query(
        "select public.apply_google_team_workweek_observations(gen_random_uuid(),1,'[]',clock_timestamp())",
      )));
      expect(error).toMatchObject({ code: "42501", message: expect.stringContaining("permission denied for function") });
    }
    const unmapped = "62000000-0000-4000-8000-000000000099";
    await client.query("insert into auth.users(id) values($1)", [unmapped]);
    expect(await captureDatabaseError(client, () => asAuthenticated(client, unmapped, () => client.query(
      "select public.apply_google_team_workweek_observations(gen_random_uuid(),1,'[]',clock_timestamp())",
    )))).toMatchObject({ code: "42501" });
    expect(await captureDatabaseError(client, async () => {
      await client.query("set local role anon");
      await client.query("select public.apply_google_team_workweek_observations(gen_random_uuid(),1,'[]',clock_timestamp())");
    })).toMatchObject({ code: "42501" });
  });
});

it("fails database verification if the server loses observation confirmation access", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await expect(verifyDatabaseSecurity(client)).resolves.toBeDefined();
    await client.query("revoke execute on function public.apply_google_team_workweek_observations(uuid,integer,jsonb,timestamptz) from service_role");
    await expect(verifyDatabaseSecurity(client)).rejects.toThrow("missing server-executable workweek observation confirmation");
  });
});
