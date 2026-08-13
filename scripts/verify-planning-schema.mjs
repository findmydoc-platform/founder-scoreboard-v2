import pg from "pg";

const [target, ...unexpected] = process.argv.slice(2).filter((argument) => argument !== "--");
if (unexpected.length || target !== "--local") {
  throw new Error("Usage: pnpm run verify:planning-items -- --local");
}

const client = new pg.Client({
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: "postgres",
  ssl: false,
  connectionTimeoutMillis: 5_000,
  application_name: "founderops-planning-schema-verifier",
});

const checks = [
  {
    name: "retired planning relations absent",
    sql: `select name as id from unnest(array[
      'packages','milestones','active_packages','planning_item_legacy_ids','team_planning_milestone_delete_requests'
    ]) name where to_regclass('public.' || name) is not null`,
  },
  {
    name: "retired planning columns absent",
    sql: `select table_name || '.' || column_name as id from information_schema.columns
      where table_schema = 'public' and ((table_name = 'tasks' and column_name in ('package_id','milestone_id'))
        or (table_name = 'profile_ui_preferences' and column_name = 'expanded_package_ids'))`,
  },
  {
    name: "historical links remain complete",
    sql: `select item_type || ':' || historical_id as id from public.planning_item_historical_links
      where item_type not in ('epic','initiative') or historical_id = '' or task_id = ''
        or source_snapshot is null or source_snapshot->>'id' is distinct from historical_id
        or (item_type = 'epic' and (source_snapshot->>'created_at' is null or source_snapshot->>'updated_at' is null))`,
  },
  {
    name: "canonical delete receipts remain valid",
    sql: `select id::text from public.team_planning_item_delete_requests
      where item_id = '' or contract_version not in (1,2) or jsonb_typeof(response) <> 'object'`,
  },
  {
    name: "canonical parent graph",
    sql: `select child.id from public.tasks child left join public.tasks parent on parent.id = child.parent_task_id
      where (child.task_type = 'epic' and child.parent_task_id is not null)
        or (child.task_type = 'initiative' and child.parent_task_id is not null and parent.task_type is distinct from 'epic')
        or (child.task_type = 'deliverable' and child.parent_task_id is not null and parent.task_type is distinct from 'initiative')
        or (child.task_type = 'sub_issue' and parent.task_type is distinct from 'deliverable')`,
  },
];

await client.connect();
try {
  await client.query("begin read only isolation level repeatable read");
  const report = [];
  for (const check of checks) {
    const result = await client.query(`select id::text from (${check.sql}) failures limit 21`);
    report.push({
      check: check.name,
      ok: result.rowCount === 0,
      failures: result.rows.slice(0, 20).map((row) => row.id),
      truncated: result.rowCount > 20,
    });
  }
  await client.query("rollback");

  const failures = report.filter((check) => !check.ok);
  console.log(JSON.stringify({ target: "local", database: "postgres", ok: failures.length === 0, checks: report }, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
