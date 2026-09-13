import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  applyMigration,
  resetLocalDatabaseTo,
  withLocalDatabase,
} from "./helpers/migration-test-harness.mjs";

const previousVersion = "20260827093325";
const migrationFile = resolve(
  process.cwd(),
  "supabase/migrations/20260912121704_planning_item_dependencies_api.sql",
);

async function seedPlanningItems(client) {
  await client.query(`
    insert into public.projects (id, name)
    values ('findmydoc-founder-execution', 'FounderOps')
  `);
  await client.query(`
    insert into public.profiles (id, name, role, platform_role)
    values ('migration-ceo', 'Migration CEO', 'member', 'ceo')
  `);
  await client.query(`
    insert into public.tasks (
      id, project_id, title, status, priority, owner, assignee,
      task_type, approval_status, github_repo, score_relevant, created_by
    ) values
      ('dependency-a', 'findmydoc-founder-execution', 'Dependency A', 'Offen', 'P2',
       'migration-ceo', 'migration-ceo', 'deliverable', 'proposed',
       'findmydoc-platform/management', false, 'migration-ceo'),
      ('dependency-b', 'findmydoc-founder-execution', 'Dependency B', 'Offen', 'P2',
       'migration-ceo', 'migration-ceo', 'deliverable', 'proposed',
       'findmydoc-platform/management', false, 'migration-ceo')
  `);
}

it("stops before the semantic constraint when historical dependency duplicates exist", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    await seedPlanningItems(client);
    await client.query(`
      insert into public.task_relationship_edges (
        task_id, related_task_id, relation_type, created_by
      ) values
        ('dependency-a', 'dependency-b', 'blocked_by', 'migration-ceo'),
        ('dependency-b', 'dependency-a', 'blocks', 'migration-ceo')
    `);

    await expect(applyMigration(client, migrationFile)).rejects.toMatchObject({
      code: "23505",
      message: expect.stringMatching(/semantic planning dependency duplicates must be resolved/),
      detail: expect.stringMatching(/dependency-a blocked_by dependency-b/),
    });
    const unchanged = await client.query(`
      select id, task_id, related_task_id, relation_type
      from public.task_relationship_edges
      order by id
    `);
    expect(unchanged.rowCount).toBe(2);
  });
});

it("adds canonical uniqueness and service-only atomic dependency RPCs without deleting data", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    await seedPlanningItems(client);
    const sharedMutationBefore = await client.query(`
      select pg_get_functiondef(
        'public.mutate_planning_relationship_transaction(text,text,text,text,bigint,text,timestamptz,text,text,text)'::regprocedure
      ) as definition
    `);
    await client.query(`
      insert into public.task_relationship_edges (
        task_id, related_task_id, relation_type, note, created_by
      ) values (
        'dependency-a', 'dependency-b', 'blocked_by', 'Existing note', 'migration-ceo'
      )
    `);

    await applyMigration(client, migrationFile);

    const sharedMutationAfter = await client.query(`
      select pg_get_functiondef(
        'public.mutate_planning_relationship_transaction(text,text,text,text,bigint,text,timestamptz,text,text,text)'::regprocedure
      ) as definition
    `);
    expect(sharedMutationAfter.rows[0].definition).toBe(sharedMutationBefore.rows[0].definition);

    const preserved = await client.query(`
      select task_id, related_task_id, relation_type, note
      from public.task_relationship_edges
    `);
    expect(preserved.rows).toEqual([{
      task_id: "dependency-a",
      related_task_id: "dependency-b",
      relation_type: "blocked_by",
      note: "Existing note",
    }]);

    const index = await client.query(`
      select indexdef
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'task_relationship_edges_unique_directional_dependency'
    `);
    expect(index.rowCount).toBe(1);
    expect(index.rows[0].indexdef).toMatch(/UNIQUE INDEX/);
    expect(index.rows[0].indexdef).toMatch(/blocked_by/);
    expect(index.rows[0].indexdef).toMatch(/blocks/);

    const privileges = await client.query(`
      select
        has_function_privilege(
          'authenticated',
          'public.prepare_team_planning_dependency_command(text,text,bigint,text,text)',
          'EXECUTE'
        ) as authenticated_prepare,
        has_function_privilege(
          'service_role',
          'public.prepare_team_planning_dependency_command(text,text,bigint,text,text)',
          'EXECUTE'
        ) as service_prepare,
        has_function_privilege(
          'authenticated',
          'public.mutate_team_planning_dependency_transaction(uuid,uuid,text,text,text,text,text,bigint,text,timestamptz,text,text,text)',
          'EXECUTE'
        ) as authenticated_mutate,
        has_function_privilege(
          'service_role',
          'public.mutate_team_planning_dependency_transaction(uuid,uuid,text,text,text,text,text,bigint,text,timestamptz,text,text,text)',
          'EXECUTE'
        ) as service_mutate
    `);
    expect(privileges.rows[0]).toEqual({
      authenticated_prepare: false,
      service_prepare: true,
      authenticated_mutate: false,
      service_mutate: true,
    });

    await expect(client.query(`
      insert into public.task_relationship_edges (
        task_id, related_task_id, relation_type, created_by
      ) values ('dependency-b', 'dependency-a', 'blocks', 'migration-ceo')
    `)).rejects.toMatchObject({ code: "23505" });

    await applyMigration(client, migrationFile);
    const afterReplay = await client.query("select count(*)::integer as count from public.task_relationship_edges");
    expect(afterReplay.rows[0].count).toBe(1);
  });
});
