import { expect, it } from "vitest";
import {
  resetLocalDatabaseTo,
  withLocalDatabase,
} from "./helpers/migration-test-harness.mjs";

const baselineVersion = "20260827064853";

it("the current schema baseline rebuilds the database without widening access", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(baselineVersion);

  await withLocalDatabase(async (client) => {
    const ledger = await client.query(
      "select version from supabase_migrations.schema_migrations order by version",
    );
    expect(ledger.rows).toEqual([{ version: baselineVersion }]);

    await client.query(`
      insert into public.projects (id, name)
      values ('baseline-project', 'Baseline project')
    `);
    await client.query(`
      insert into public.profiles (id, name, role, platform_role)
      values ('baseline-founder', 'Baseline Founder', 'member', 'founder')
    `);
    await client.query(`
      insert into public.tasks (
        id,
        project_id,
        title,
        status,
        priority,
        owner,
        task_type,
        approval_status,
        github_repo,
        created_by
      ) values (
        'baseline-deliverable',
        'baseline-project',
        'Preserved baseline deliverable',
        'Offen',
        'P2',
        'baseline-founder',
        'deliverable',
        'draft',
        'findmydoc-platform/management',
        'baseline-founder'
      )
    `);
    const activeTask = await client.query(`
      select id, project_id, title, owner, task_type, approval_status
      from public.active_tasks
      where id = 'baseline-deliverable'
    `);
    expect(activeTask.rows).toEqual([{
      id: "baseline-deliverable",
      project_id: "baseline-project",
      title: "Preserved baseline deliverable",
      owner: "baseline-founder",
      task_type: "deliverable",
      approval_status: "draft",
    }]);

    const tablesWithoutRls = await client.query(`
      select relation.relname
      from pg_class relation
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relkind = 'r'
        and not relation.relrowsecurity
      order by relation.relname
    `);
    expect(tablesWithoutRls.rows).toEqual([]);

    const bucket = await client.query(`
      select id, name, public, file_size_limit::text, allowed_mime_types
      from storage.buckets
      where id = 'fmd-tool-previews'
    `);
    expect(bucket.rows).toEqual([{
      id: "fmd-tool-previews",
      name: "fmd-tool-previews",
      public: true,
      file_size_limit: "5242880",
      allowed_mime_types: ["image/png", "image/jpeg", "image/webp", "image/gif"],
    }]);

    const taskPrivileges = await client.query(`
      select
        has_table_privilege('anon', 'public.tasks', 'select') as anon_select,
        has_table_privilege('authenticated', 'public.tasks', 'select') as authenticated_select,
        has_table_privilege('authenticated', 'public.tasks', 'insert') as authenticated_insert,
        has_table_privilege('authenticated', 'public.tasks', 'update') as authenticated_update,
        has_table_privilege('service_role', 'public.tasks', 'insert') as service_role_insert
    `);
    expect(taskPrivileges.rows[0]).toEqual({
      anon_select: false,
      authenticated_select: true,
      authenticated_insert: false,
      authenticated_update: false,
      service_role_insert: true,
    });
  });
});
