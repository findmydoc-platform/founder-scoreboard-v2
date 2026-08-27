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
        `insert into public.profiles (id, auth_user_id, name, role, platform_role)
         values ($1, $2, $3, 'member', $4)`,
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
