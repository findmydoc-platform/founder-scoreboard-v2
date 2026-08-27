import { expect, it } from "vitest";
import {
  captureDatabaseError,
  withIsolatedLocalDatabase,
} from "./helpers/local-database";

it("persists a fixed date only for deliverables and rejects legacy schedule fields", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await client.query(`
      insert into public.projects (id, name)
      values ('integration-schedule-project', 'Integration schedule project')
    `);
    await client.query(`
      insert into public.profiles (id, name, role, platform_role)
      values ('integration-schedule-founder', 'Integration Founder', 'member', 'founder')
    `);
    await client.query(`
      insert into public.tasks (
        id, project_id, title, status, priority, task_type, approval_status,
        score_relevant, github_issue_sync_status
      ) values (
        'integration-schedule-initiative', 'integration-schedule-project', 'Initiative',
        'Offen', 'P2', 'initiative', 'approved', false, 'not_applicable'
      )
    `);
    await client.query(`
      insert into public.tasks (
        id, project_id, title, status, priority, task_type, approval_status,
        score_relevant, github_repo, parent_task_id, fixed_date
      ) values (
        'integration-schedule-deliverable', 'integration-schedule-project', 'Deliverable',
        'Offen', 'P2', 'deliverable', 'approved', false,
        'findmydoc-platform/management', 'integration-schedule-initiative', '2026-09-12'
      )
    `);

    const projected = await client.query(`
      select fixed_date::text as fixed_date
      from public.active_tasks
      where id = 'integration-schedule-deliverable'
    `);
    expect(projected.rows).toEqual([{ fixed_date: "2026-09-12" }]);

    const subIssueError = await captureDatabaseError(client, () => client.query(`
      insert into public.tasks (
        id, project_id, title, status, priority, task_type, approval_status,
        score_relevant, github_repo, parent_task_id, fixed_date
      ) values (
        'integration-schedule-sub-issue', 'integration-schedule-project', 'Sub-Issue',
        'Offen', 'P2', 'sub_issue', null, false,
        'findmydoc-platform/management', 'integration-schedule-deliverable', '2026-09-13'
      )
    `));
    expect(subIssueError).toMatchObject({
      code: "23514",
      message: expect.stringMatching(/tasks_fixed_date_deliverable_check/),
    });

    const legacyFieldError = await captureDatabaseError(client, () => client.query(`
      update public.tasks
      set deadline = 'Sprint 9'
      where id = 'integration-schedule-deliverable'
    `));
    expect(legacyFieldError).toMatchObject({
      code: "23514",
      message: expect.stringMatching(/tasks_legacy_schedule_empty_check/),
    });
  });
}, 30_000);
