import { expect, it } from "vitest";
import { withIsolatedLocalDatabase } from "./helpers/local-database";

it("round-trips long Unicode planning text without a storage migration", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await client.query("insert into public.projects (id, name) values ('content-contract', 'Content contract')");
    const description = "😀".repeat(65_536);
    await client.query(`
      insert into public.tasks (id, project_id, title, task_type, status, priority, approval_status, score_relevant, github_issue_sync_status, description)
      values ('content-initiative', 'content-contract', 'Unicode initiative', 'initiative', 'Offen', 'P2', 'proposed', false, 'not_applicable', $1)
    `, [description]);
    const criteria = "ä\u0308".repeat(32_768);
    await client.query("insert into public.planning_item_strategy (task_id, goal, success_criteria, scope_constraints) values ('content-initiative', $1, $2, $1)", [description, criteria]);
    const result = await client.query("select task.description, strategy.goal, strategy.success_criteria from public.active_tasks task join public.planning_item_strategy strategy on strategy.task_id = task.id where task.id = 'content-initiative'");
    expect(result.rows).toEqual([{ description, goal: description, success_criteria: criteria }]);
  });
}, 30_000);
