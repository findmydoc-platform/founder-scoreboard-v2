import pg from "pg";

const [target, phase, ...unexpected] = process.argv.slice(2).filter((argument) => argument !== "--");
if (unexpected.length || target !== "--local" || !["--parity", "--ready-to-drop"].includes(phase)) {
  throw new Error("Usage: pnpm run verify:planning-legacy-cutover -- --local --parity|--ready-to-drop");
}

const localDatabase = process.env.PLANNING_CUTOVER_LOCAL_DATABASE || "postgres";
if (!/^(postgres|founderops_cutover_restore_[a-z0-9_]+)$/.test(localDatabase)) {
  throw new Error("Refusing unrecognized local cutover verification database.");
}

const connection = {
  host: "127.0.0.1",
  port: 54322,
  user: "postgres",
  password: "postgres",
  database: localDatabase,
  ssl: false,
  connectionTimeoutMillis: 5_000,
  application_name: "founderops-planning-legacy-cutover-preflight",
};

const parityChecks = [
  {
    name: "legacy mapping shape",
    sql: `
      select source_kind || ':' || legacy_id as id
      from public.planning_item_legacy_ids
      where source_kind not in ('milestone', 'package')
         or legacy_id = '' or task_id = '' or project_id = ''
    `,
  },
  {
    name: "Milestone row count and mapping",
    sql: `
      with legacy as (
        select m.id, l.task_id
        from public.milestones m
        left join public.planning_item_legacy_ids l
          on l.source_kind = 'milestone' and l.legacy_id = m.id
      )
      select coalesce(id, task_id, '<missing>') as id
      from legacy
      where task_id is null
      union all
      select l.legacy_id
      from public.planning_item_legacy_ids l
      left join public.milestones m on m.id = l.legacy_id
      where l.source_kind = 'milestone' and m.id is null
    `,
  },
  {
    name: "Milestone field parity",
    sql: `
      select m.id
      from public.milestones m
      join public.planning_item_legacy_ids l
        on l.source_kind = 'milestone' and l.legacy_id = m.id
      left join public.tasks t on t.id = l.task_id
      where t.id is null
         or t.task_type <> 'epic'
         or t.project_id is distinct from m.project_id
         or t.title is distinct from m.title
         or coalesce(t.description, '') is distinct from coalesce(m.description, '')
         or t.target_date is distinct from m.target_date
         or t.sort_order is distinct from m.sort_order
         or t.status is distinct from case m.status
              when 'active' then 'In Arbeit'
              when 'done' then 'Erledigt'
              else 'Offen'
            end
    `,
  },
  {
    name: "Package row count and mapping",
    sql: `
      with legacy as (
        select p.id, l.task_id
        from public.packages p
        left join public.planning_item_legacy_ids l
          on l.source_kind = 'package' and l.legacy_id = p.id
      )
      select coalesce(id, task_id, '<missing>') as id
      from legacy
      where task_id is null
      union all
      select l.legacy_id
      from public.planning_item_legacy_ids l
      left join public.packages p on p.id = l.legacy_id
      where l.source_kind = 'package' and p.id is null
    `,
  },
  {
    name: "Package fields, parent, approval, trash, and strategy parity",
    sql: `
      select p.id
      from public.packages p
      join public.planning_item_legacy_ids l
        on l.source_kind = 'package' and l.legacy_id = p.id
      left join public.tasks t on t.id = l.task_id
      left join public.planning_item_legacy_ids parent_map
        on parent_map.source_kind = 'milestone' and parent_map.legacy_id = p.milestone_id
      left join public.planning_item_strategy strategy on strategy.task_id = t.id
      where t.id is null
         or t.task_type <> 'initiative'
         or t.project_id is distinct from p.project_id
         or t.title is distinct from p.title
         or coalesce(t.description, '') is distinct from coalesce(p.goal, '')
         or coalesce(t.priority, '') is distinct from coalesce(p.priority, '')
         or t.sort_order is distinct from p.sort_order
         or t.parent_task_id is distinct from parent_map.task_id
         or t.owner is distinct from p.owner_id
         or t.target_date is distinct from p.target_date
         or t.status is distinct from case p.status
              when 'active' then 'In Arbeit'
              when 'paused' then 'Pausiert'
              when 'done' then 'Erledigt'
              else 'Offen'
            end
         or t.approval_status is distinct from p.approval_status
         or t.approval_revision is distinct from p.approval_revision
         or t.proposed_by is distinct from p.proposed_by
         or t.proposed_at is distinct from p.proposed_at
         or t.decided_by is distinct from p.decided_by
         or t.decided_at is distinct from p.decided_at
         or t.decision_note is distinct from p.decision_note
         or t.trashed_at is distinct from p.trashed_at
         or t.trashed_by is distinct from p.trashed_by
         or t.trash_reason is distinct from p.trash_reason
         or t.trash_cause is distinct from p.trash_cause
         or t.purge_after is distinct from p.purge_after
         or t.trash_root_type is distinct from p.trash_root_type
         or t.trash_root_id is distinct from p.trash_root_id
         or t.trash_revision is distinct from p.trash_revision
         or coalesce(strategy.goal, '') is distinct from coalesce(p.goal, '')
         or coalesce(strategy.success_criteria, '') is distinct from coalesce(p.success_criteria, '')
         or coalesce(strategy.scope_constraints, '') is distinct from coalesce(p.scope_constraints, '')
    `,
  },
  {
    name: "Package RACI parity",
    sql: `
      with legacy as (
        select l.task_id, p.id,
          array_remove(array[p.accountable_profile_id], null) as accountable,
          coalesce(p.responsible_profile_ids, '{}'::text[]) as responsible,
          coalesce(p.consulted_profile_ids, '{}'::text[]) as consulted,
          coalesce(p.informed_profile_ids, '{}'::text[]) as informed
        from public.packages p
        join public.planning_item_legacy_ids l
          on l.source_kind = 'package' and l.legacy_id = p.id
      ), canonical as (
        select legacy.task_id, legacy.id,
          coalesce(array_agg(r.profile_id order by r.sort_order, r.profile_id) filter (where r.role = 'accountable'), '{}'::text[]) as accountable,
          coalesce(array_agg(r.profile_id order by r.sort_order, r.profile_id) filter (where r.role = 'responsible'), '{}'::text[]) as responsible,
          coalesce(array_agg(r.profile_id order by r.sort_order, r.profile_id) filter (where r.role = 'consulted'), '{}'::text[]) as consulted,
          coalesce(array_agg(r.profile_id order by r.sort_order, r.profile_id) filter (where r.role = 'informed'), '{}'::text[]) as informed
        from legacy
        left join public.planning_item_raci_assignments r on r.task_id = legacy.task_id
        group by legacy.task_id, legacy.id
      )
      select legacy.id
      from legacy
      join canonical using (task_id, id)
      where legacy.accountable is distinct from canonical.accountable
         or legacy.responsible is distinct from canonical.responsible
         or legacy.consulted is distinct from canonical.consulted
         or legacy.informed is distinct from canonical.informed
    `,
  },
  {
    name: "canonical parent graph",
    sql: `
      select child.id
      from public.tasks child
      left join public.tasks parent on parent.id = child.parent_task_id
      where (child.task_type = 'epic' and child.parent_task_id is not null)
         or (child.task_type = 'initiative' and child.parent_task_id is not null and parent.task_type is distinct from 'epic')
         or (child.task_type = 'deliverable' and child.parent_task_id is not null and parent.task_type is distinct from 'initiative')
         or (child.task_type = 'sub_issue' and (parent.id is null or parent.task_type is distinct from 'deliverable'))
         or child.task_type not in ('epic', 'initiative', 'deliverable', 'sub_issue')
    `,
  },
  {
    name: "derived Package and Milestone columns",
    sql: `
      select child.id
      from public.tasks child
      left join public.tasks parent on parent.id = child.parent_task_id
      left join public.tasks grandparent on grandparent.id = parent.parent_task_id
      left join public.planning_item_legacy_ids parent_package
        on parent_package.source_kind = 'package'
       and parent_package.task_id = case
         when child.task_type = 'deliverable' then parent.id
         when child.task_type = 'sub_issue' then grandparent.id
       end
      left join public.planning_item_legacy_ids parent_milestone
        on parent_milestone.source_kind = 'milestone'
       and parent_milestone.task_id = case
         when child.task_type = 'initiative' then parent.id
         when child.task_type = 'deliverable' then grandparent.id
         when child.task_type = 'sub_issue' then (select epic.id from public.tasks epic where epic.id = grandparent.parent_task_id)
       end
      where child.package_id is distinct from parent_package.legacy_id
         or child.milestone_id is distinct from parent_milestone.legacy_id
    `,
  },
  {
    name: "approval and trash invariants",
    sql: `
      select item.id
      from public.tasks item
      left join public.tasks parent on parent.id = item.parent_task_id
      where (item.task_type in ('epic', 'sub_issue') and item.approval_status is not null)
         or (item.task_type in ('initiative', 'deliverable') and item.approval_status not in ('draft', 'proposed', 'approved', 'rejected'))
         or (item.task_type = 'sub_issue' and parent.approval_status is distinct from 'approved')
         or (item.trashed_at is null and (
              item.trashed_by is not null or item.trash_reason is not null or item.trash_cause is not null
              or item.purge_after is not null or item.trash_root_type is not null or item.trash_root_id is not null
            ))
         or (item.trashed_at is not null and (
              item.trashed_by is null or item.trash_reason is null or item.trash_cause is null
              or item.purge_after is null or item.trash_root_type is null or item.trash_root_id is null
            ))
    `,
  },
  {
    name: "canonical preference values",
    sql: `
      select preference.profile_id as id
      from public.profile_ui_preferences preference
      where coalesce(preference.planning_filters->>'packageId', 'Alle') not in ('', 'Alle')
        and not exists (
          select 1 from public.tasks initiative
          where initiative.id = preference.planning_filters->>'packageId'
            and initiative.task_type = 'initiative'
        )
      union
      select preference.profile_id as id
      from public.profile_ui_preferences preference
      cross join lateral unnest(preference.expanded_package_ids) expanded(item_id)
      where expanded.item_id <> 'Alle'
        and not exists (
          select 1 from public.tasks initiative
          where initiative.id = expanded.item_id and initiative.task_type = 'initiative'
        )
    `,
  },
];

const readyToDropChecks = [
  {
    name: "legacy create replay snapshots",
    sql: "select id::text as id from public.team_task_intake_batches where contract_version = 1",
  },
  {
    name: "legacy update replay snapshots",
    sql: "select id::text as id from public.team_planning_item_update_requests where contract_version = 1",
  },
  {
    name: "special Epic delete replay storage",
    sql: "select id::text as id from public.team_planning_milestone_delete_requests",
  },
];

const client = new pg.Client(connection);
await client.connect();

try {
  await client.query("begin read only isolation level repeatable read");
  const checks = phase === "--ready-to-drop" ? [...parityChecks, ...readyToDropChecks] : parityChecks;
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
  console.log(JSON.stringify({ target: "local", database: localDatabase, phase: phase.slice(2), ok: failures.length === 0, checks: report }, null, 2));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  await client.end();
}
