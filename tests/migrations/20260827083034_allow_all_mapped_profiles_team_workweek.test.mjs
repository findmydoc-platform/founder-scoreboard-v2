import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  applyMigration,
  assertRowsPreserved,
  resetLocalDatabaseTo,
  snapshotRows,
  withLocalDatabase,
} from "./helpers/migration-test-harness.mjs";

const previousVersion = "20260827064853";
const migrationFile = resolve(
  process.cwd(),
  "supabase/migrations/20260827083034_allow_all_mapped_profiles_team_workweek.sql",
);

const teamMembers = [
  { id: "migration-ceo", role: "ceo", authUserId: "10000000-0000-0000-0000-000000000001" },
  { id: "migration-founder", role: "founder", authUserId: "10000000-0000-0000-0000-000000000002" },
  { id: "migration-deputy", role: "deputy", authUserId: "10000000-0000-0000-0000-000000000003" },
  { id: "migration-viewer", role: "viewer", authUserId: "10000000-0000-0000-0000-000000000004" },
];
const unmappedAuthUserId = "10000000-0000-0000-0000-000000000099";

async function asAuthenticated(client, authUserId, callback) {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [authUserId]);
  await client.query("select set_config('request.jwt.claim.role', 'authenticated', false)");
  await client.query("set role authenticated");
  try {
    return await callback();
  } finally {
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', '', false)");
    await client.query("select set_config('request.jwt.claim.role', '', false)");
  }
}

async function expectDatabaseError(operation, code, message) {
  await expect(operation()).rejects.toMatchObject({
    code,
    message: expect.stringMatching(message),
  });
}

async function snapshots(client) {
  return {
    versions: await snapshotRows(client, {
      table: "team_workweek_versions",
      columns: ["id", "owner_profile_id", "effective_from", "timezone", "status", "origin"],
      orderBy: ["id"],
    }),
    windows: await snapshotRows(client, {
      table: "team_workweek_windows",
      columns: ["id", "version_id", "weekday", "start_minute", "end_minute"],
      orderBy: ["id"],
    }),
    publications: await snapshotRows(client, {
      table: "team_workweek_publications",
      columns: [
        "id",
        "source_version_id",
        "owner_profile_id",
        "effective_from",
        "timezone",
        "windows",
        "status",
        "publication_revision",
        "sync_state",
      ],
      orderBy: ["id"],
    }),
  };
}

it("all mapped roles can manage only their own workweek after the migration", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    const authUserIds = [...teamMembers.map(({ authUserId }) => authUserId), unmappedAuthUserId];
    await client.query(
      "insert into auth.users (id) select unnest($1::uuid[])",
      [authUserIds],
    );
    for (const member of teamMembers) {
      await client.query(
        `insert into public.profiles (id, auth_user_id, name, role, platform_role)
         values ($1, $2, $3, 'member', $4)`,
        [member.id, member.authUserId, `Migration ${member.role}`, member.role],
      );
    }

    const dates = await client.query(`
      select
        (date_trunc('week', clock_timestamp() at time zone 'Europe/Berlin')::date + 14) as published_monday,
        (date_trunc('week', clock_timestamp() at time zone 'Europe/Berlin')::date + 28) as next_monday
    `);
    const { published_monday: publishedMonday, next_monday: nextMonday } = dates.rows[0];

    await client.query(
      `insert into public.team_workweek_versions (id, owner_profile_id, effective_from)
       values
         ('20000000-0000-0000-0000-000000000001', 'migration-founder', $1),
         ('20000000-0000-0000-0000-000000000002', 'migration-ceo', $2)`,
      [publishedMonday, nextMonday],
    );
    await client.query(`
      insert into public.team_workweek_windows (id, version_id, weekday, start_minute, end_minute)
      values
        (2001, '20000000-0000-0000-0000-000000000001', 1, 540, 720),
        (2002, '20000000-0000-0000-0000-000000000002', 2, 600, 780)
    `);
    await client.query(
      `insert into public.team_workweek_publications (
         id, source_version_id, owner_profile_id, effective_from, windows, status,
         publication_revision, published_at, last_sync_at, sync_state
       ) values (
         '30000000-0000-0000-0000-000000000001',
         '20000000-0000-0000-0000-000000000001',
         'migration-founder',
         $1,
         '[{"weekday":1,"startMinute":540,"endMinute":720}]'::jsonb,
         'published',
         1,
         clock_timestamp(),
         clock_timestamp(),
         'confirmed'
       )`,
      [publishedMonday],
    );

    await expectDatabaseError(
      () => asAuthenticated(client, teamMembers[3].authUserId, () => client.query(
        "select public.create_private_team_workweek_version($1, '[]'::jsonb)",
        [nextMonday],
      )),
      "42501",
      /viewer cannot create/,
    );

    const before = await snapshots(client);
    await applyMigration(client, migrationFile);
    const after = await snapshots(client);
    assertRowsPreserved(before.versions, after.versions);
    assertRowsPreserved(before.windows, after.windows);
    assertRowsPreserved(before.publications, after.publications);

    const createdVersionIds = new Map();
    for (const [index, member] of teamMembers.entries()) {
      const effectiveDateResult = await client.query(
        "select ($1::date + ($2::integer * 7))::text as effective_date",
        [nextMonday, index + 1],
      );
      const effectiveDate = effectiveDateResult.rows[0].effective_date;

      await asAuthenticated(client, member.authUserId, async () => {
        const created = await client.query(
          `select public.create_private_team_workweek_version(
             $1,
             '[{"weekday":3,"startMinute":540,"endMinute":1020}]'::jsonb
           ) as version`,
          [effectiveDate],
        );
        const versionId = created.rows[0].version.id;
        createdVersionIds.set(member.id, versionId);
        expect(created.rows[0].version.status).toBe("preparing");

        const privateVersions = await client.query(
          "select owner_profile_id from public.team_workweek_versions order by owner_profile_id",
        );
        expect(privateVersions.rows.length).toBeGreaterThanOrEqual(1);
        expect(privateVersions.rows.every((row) => row.owner_profile_id === member.id)).toBe(true);

        const publishedTeamRows = await client.query(
          "select owner_profile_id from public.team_workweek_publications where status = 'published'",
        );
        expect(publishedTeamRows.rows).toEqual([{ owner_profile_id: "migration-founder" }]);

        const prepared = await client.query(
          "select public.prepare_team_workweek_publication($1) as publication",
          [versionId],
        );
        expect(prepared.rows[0].publication.ownerProfileId).toBe(member.id);
        expect(prepared.rows[0].publication.status).toBe("preparing");
      });
    }

    await expectDatabaseError(
      () => asAuthenticated(client, teamMembers[3].authUserId, () => client.query(
        "select public.prepare_team_workweek_publication($1)",
        [createdVersionIds.get("migration-ceo")],
      )),
      "P0002",
      /private team workweek version not found/,
    );

    await asAuthenticated(client, unmappedAuthUserId, async () => {
      const publishedRows = await client.query(
        "select id from public.team_workweek_publications where status = 'published'",
      );
      expect(publishedRows.rowCount).toBe(0);
      await expectDatabaseError(
        () => client.query(
          "select public.create_private_team_workweek_version($1, '[]'::jsonb)",
          [nextMonday],
        ),
        "42501",
        /mapped team profile required/,
      );
    });

    await expectDatabaseError(
      () => asAuthenticated(client, teamMembers[3].authUserId, () => client.query(
        `insert into public.team_workweek_versions (owner_profile_id, effective_from)
         values ('migration-viewer', $1)`,
        [nextMonday],
      )),
      "42501",
      /permission denied/,
    );
  });
});
