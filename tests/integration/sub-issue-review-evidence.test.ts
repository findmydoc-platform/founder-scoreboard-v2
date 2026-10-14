import { expect, it } from "vitest";
import { captureDatabaseError, withIsolatedLocalDatabase } from "./helpers/local-database";

it("accepts direct active Sub-Issue evidence for a parent review without copying links", async () => {
  await withIsolatedLocalDatabase(async (client) => {
    await client.query("select set_config('app.planning_hierarchy_backfill', 'true', true)");
    await client.query(`insert into public.projects (id, name) values ('evidence-project', 'Evidence project')`);
    await client.query(`insert into public.profiles (id, name, platform_role) values ('evidence-actor', 'Evidence actor', 'ceo')`);
    await client.query(`insert into public.tasks
      (id, project_id, title, task_type, status, priority, approval_status, score_relevant, parent_task_id)
      values
      ('evidence-parent', 'evidence-project', 'Parent', 'deliverable', 'Offen', 'P2', 'approved', false, null),
      ('evidence-child', 'evidence-project', 'Child', 'sub_issue', 'Offen', 'P2', null, false, 'evidence-parent'),
      ('evidence-other', 'evidence-project', 'Other', 'deliverable', 'Offen', 'P2', 'approved', false, null),
      ('evidence-unrelated', 'evidence-project', 'Unrelated', 'sub_issue', 'Offen', 'P2', null, false, 'evidence-other')`);
    await client.query(`insert into public.tasks
      (id, project_id, title, task_type, status, priority, approval_status, score_relevant, parent_task_id, sort_order)
      select 'evidence-extra-' || index, 'evidence-project', 'Empty child ' || index, 'sub_issue',
        'Offen', 'P2', null, false, 'evidence-parent', index from generate_series(1, 200) as index`);
    await client.query(`update public.tasks set sort_order = 201 where id = 'evidence-child'`);
    const requestReview = () => client.query(`update public.tasks
      set status = 'Review', review_status = 'requested' where id = 'evidence-parent'`);
    const evidencePresent = async () => (await client.query(
      "select public.has_valid_planning_review_evidence('evidence-parent') as present",
    )).rows[0].present;

    await client.query(`insert into public.task_links (task_id, type, label, url)
      values ('evidence-unrelated', 'evidence', 'Unrelated proof', 'https://example.com/unrelated')`);
    expect(await evidencePresent()).toBe(false);
    expect(await captureDatabaseError(client, requestReview)).toMatchObject({ code: "P0017" });
    await client.query(`insert into public.task_links (task_id, type, label, url, metadata)
      values ('evidence-child', 'github_pull_request', 'Form PR', 'https://github.com/example/web/pull/42', '{}'::jsonb)`);
    expect(await evidencePresent()).toBe(false);
    await client.query(`update public.task_links
      set metadata = '{"repository":"example/web","number":42,"status":"merged"}'::jsonb
      where task_id = 'evidence-child'`);
    expect(await evidencePresent()).toBe(true);
    await requestReview();
    const parent = await client.query(`select evidence_link, review_evidence_exception_note
      from public.tasks where id = 'evidence-parent'`);
    expect(parent.rows).toEqual([{ evidence_link: null, review_evidence_exception_note: null }]);
    const parentLinks = await client.query("select id from public.task_links where task_id = 'evidence-parent'");
    expect(parentLinks.rowCount).toBe(0);

    await client.query(`update public.tasks set status = 'Offen', review_status = 'not_requested' where id = 'evidence-parent'`);
    await client.query(`update public.tasks set parent_task_id = 'evidence-other' where id = 'evidence-child'`);
    expect(await evidencePresent()).toBe(false);
    await client.query(`update public.tasks set parent_task_id = 'evidence-parent' where id = 'evidence-child'`);
    await client.query(`delete from public.task_links where task_id = 'evidence-child'`);
    await client.query(`update public.tasks set evidence_link = 'https://example.com/legacy' where id = 'evidence-child'`);
    expect(await evidencePresent()).toBe(true);
    await client.query(`update public.tasks set evidence_link = null where id = 'evidence-child'`);
    await client.query(`insert into public.task_links (task_id, type, label, url)
      values ('evidence-child', 'evidence', 'Test report', 'https://example.com/report')`);
    expect(await evidencePresent()).toBe(true);
    await client.query("select set_config('founderops.trash_lifecycle_write', 'on', true)");
    await client.query(`update public.tasks set trashed_at = now(), trashed_by = 'evidence-actor',
      trash_reason = 'Withdrawn work', trash_cause = 'withdrawn', purge_after = now() + interval '90 days',
      trash_root_type = 'deliverable', trash_root_id = 'evidence-parent', trash_revision = 1
      where id = 'evidence-child'`);
    await client.query("select set_config('founderops.trash_lifecycle_write', 'off', true)");
    expect(await evidencePresent()).toBe(false);
    expect(await captureDatabaseError(client, requestReview)).toMatchObject({ code: "P0017" });
    await client.query(`update public.tasks set review_evidence_exception_note = 'Accepted in meeting',
      review_evidence_exception_confirmed_at = now(), status = 'Review', review_status = 'requested'
      where id = 'evidence-parent'`);
    const exception = await client.query(`select review_evidence_exception_note,
      review_evidence_exception_confirmed_at is not null as confirmed from public.tasks where id = 'evidence-parent'`);
    expect(exception.rows).toEqual([{ review_evidence_exception_note: "Accepted in meeting", confirmed: true }]);
    const privileges = await client.query(`select
      has_function_privilege('service_role', 'public.has_valid_planning_review_evidence(text)', 'EXECUTE') as service,
      has_function_privilege('authenticated', 'public.has_valid_planning_review_evidence(text)', 'EXECUTE') as authenticated,
      has_function_privilege('anon', 'public.has_valid_planning_review_evidence(text)', 'EXECUTE') as anonymous`);
    expect(privileges.rows).toEqual([{ service: true, authenticated: false, anonymous: false }]);
  });
}, 30_000);
