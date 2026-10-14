import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  applyMigration,
  resetLocalDatabaseTo,
  withLocalDatabase,
} from "./helpers/migration-test-harness.mjs";

const previousVersion = "20260917073842";
const migrationFile = resolve(
  process.cwd(),
  "supabase/migrations/20260917103232_revoke_review_evidence_trigger_execute.sql",
);

async function clientExecutePrivileges(client) {
  const result = await client.query(`
    select
      has_function_privilege(
        'anon',
        'public.enforce_task_review_evidence_gate()',
        'EXECUTE'
      ) as anon,
      has_function_privilege(
        'authenticated',
        'public.enforce_task_review_evidence_gate()',
        'EXECUTE'
      ) as authenticated
  `);
  return result.rows[0];
}

it.sequential("removes client execution rights without disabling the review evidence trigger", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    expect(await clientExecutePrivileges(client)).toEqual({
      anon: true,
      authenticated: true,
    });

    await applyMigration(client, migrationFile);

    expect(await clientExecutePrivileges(client)).toEqual({
      anon: false,
      authenticated: false,
    });

    const trigger = await client.query(`
      select trigger.tgenabled as enabled
      from pg_trigger trigger
      where trigger.tgrelid = 'public.tasks'::regclass
        and trigger.tgname = 'tasks_review_evidence_gate'
    `);
    expect(trigger.rows).toEqual([{ enabled: "O" }]);

    await applyMigration(client, migrationFile);
  });
});
