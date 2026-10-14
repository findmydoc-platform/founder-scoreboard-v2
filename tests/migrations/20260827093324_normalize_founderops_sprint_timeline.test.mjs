import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  applyMigration,
  resetLocalDatabaseTo,
  withLocalDatabase,
} from "./helpers/migration-test-harness.mjs";

const previousVersion = "20260827083034";
const migrationFile = resolve(
  process.cwd(),
  "supabase/migrations/20260827093324_normalize_founderops_sprint_timeline.sql",
);

const canonicalTimeline = [
  ["Sprint 1", "2026-05-18", "2026-05-31"],
  ["Sprint 2", "2026-06-01", "2026-06-14"],
  ["Sprint 3", "2026-06-15", "2026-06-28"],
  ["Sprint 4", "2026-06-29", "2026-07-12"],
  ["Sprint 5", "2026-07-13", "2026-07-26"],
  ["Sprint 6", "2026-07-27", "2026-08-09"],
  ["Sprint 7", "2026-08-10", "2026-08-23"],
  ["Sprint 8", "2026-08-24", "2026-09-06"],
  ["Sprint 9", "2026-09-07", "2026-09-20"],
  ["Sprint 10", "2026-09-21", "2026-10-04"],
];

it("normalizes the FounderOps sprint timeline without replacing related rows", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    await client.query(`
      insert into public.projects (id, name, review_objection_window_hours)
      values
        ('findmydoc-founder-execution', 'FounderOps', 72),
        ('unrelated-project', 'Unrelated', 48)
    `);
    await client.query(`
      insert into public.profiles (id, name, role, platform_role)
      values ('migration-founder', 'Migration Founder', 'member', 'founder')
    `);

    for (const [index, [name]] of canonicalTimeline.entries()) {
      await client.query(
        `insert into public.sprints (
           id, project_id, name, status, start_date, end_date, score_locked, review_due_at
         ) values ($1, 'findmydoc-founder-execution', $2, 'planning', $3, $4, $5, null)`,
        [
          `sprint-${index + 1}`,
          name,
          `2026-${String(index + 1).padStart(2, "0")}-01`,
          `2026-${String(index + 1).padStart(2, "0")}-02`,
          index === 2,
        ],
      );
    }
    await client.query(`
      insert into public.sprints (id, project_id, name, status, start_date, end_date)
      values ('unrelated-sprint', 'unrelated-project', 'Sprint 1', 'planning', '2027-01-01', '2027-01-14')
    `);
    await client.query(`
      insert into public.tasks (
        id, project_id, title, status, priority, task_type, approval_status,
        score_relevant, github_issue_sync_status
      ) values (
        'migration-initiative', 'findmydoc-founder-execution', 'Migration Initiative',
        'Offen', 'P2', 'initiative', 'approved', false, 'not_applicable'
      )
    `);
    await client.query(`
      insert into public.tasks (
        id, project_id, title, status, priority, task_type, approval_status,
        sprint_id, score_relevant, github_repo, parent_task_id
      ) values (
        'assigned-deliverable', 'findmydoc-founder-execution', 'Assigned', 'Offen', 'P2',
        'deliverable', 'approved', 'sprint-8', true, 'findmydoc-platform/management',
        'migration-initiative'
      )
    `);
    await client.query(`
      insert into public.sprint_commitments (sprint_id, profile_id, weekly_hours)
      values ('sprint-8', 'migration-founder', 12)
    `);

    await applyMigration(client, migrationFile);

    const sprints = await client.query(`
      select
        name,
        start_date::text as start_date,
        end_date::text as end_date,
        status,
        score_locked,
        review_due_at = ((end_date + time '23:59:59.999') at time zone 'Europe/Berlin')
          + interval '72 hours' as review_due_matches
      from public.sprints
      where project_id = 'findmydoc-founder-execution'
      order by start_date
    `);
    expect(
      sprints.rows.map(({ name, start_date: startDate, end_date: endDate }) => [name, startDate, endDate]),
    ).toEqual(canonicalTimeline);
    expect(sprints.rows.every((row) => row.review_due_matches)).toBe(true);
    expect(sprints.rows.find((row) => row.name === "Sprint 3").status).toBe("closed");

    const today = await client.query(
      "select ((clock_timestamp() at time zone 'Europe/Berlin')::date)::text as today",
    );
    const todayText = today.rows[0].today;
    const current = canonicalTimeline.filter(([, startDate, endDate]) => (
      startDate <= todayText && endDate >= todayText
    ));
    const active = sprints.rows.filter((row) => row.status === "active");
    expect(active).toHaveLength(current.some(([name]) => name !== "Sprint 3") ? 1 : 0);

    const preserved = await client.query(`
      select
        (select sprint_id from public.tasks where id = 'assigned-deliverable') as sprint_id,
        (select count(*)::integer from public.sprint_commitments where sprint_id = 'sprint-8') as commitments,
        (select start_date::text from public.sprints where id = 'unrelated-sprint') as unrelated_start
    `);
    expect(preserved.rows[0]).toEqual({
      sprint_id: "sprint-8",
      commitments: 1,
      unrelated_start: "2027-01-01",
    });

    const firstRun = await client.query(`
      select id, start_date::text, end_date::text, status, score_locked, review_due_at
      from public.sprints
      where project_id = 'findmydoc-founder-execution'
      order by id
    `);
    await applyMigration(client, migrationFile);
    const secondRun = await client.query(`
      select id, start_date::text, end_date::text, status, score_locked, review_due_at
      from public.sprints
      where project_id = 'findmydoc-founder-execution'
      order by id
    `);
    expect(secondRun.rows).toEqual(firstRun.rows);
  });
});
