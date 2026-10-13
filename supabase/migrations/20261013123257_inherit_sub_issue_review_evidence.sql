create or replace function public.has_valid_planning_review_evidence(p_task_id text)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  with parent as (
    select id, task_type, project_id
    from public.tasks
    where id = p_task_id and trashed_at is null
  ), evidence_tasks as (
    select task.id, task.evidence_link
    from public.tasks task
    join parent on task.id = parent.id
      or (
        parent.task_type = 'deliverable'
        and task.task_type = 'sub_issue'
        and task.parent_task_id = parent.id
        and task.project_id = parent.project_id
      )
    where task.trashed_at is null
  )
  select exists (
    select 1 from evidence_tasks where evidence_link ~* '^https?://'
  ) or exists (
    select 1
    from public.task_links link
    join evidence_tasks task on task.id = link.task_id
    where link.type in ('evidence', 'github_pull_request')
      and link.url ~* '^https?://'
      and (
        link.type = 'evidence'
        or (
          nullif(trim(link.metadata->>'repository'), '') is not null
          and link.metadata->>'number' ~ '^[1-9][0-9]*$'
          and link.metadata->>'status' in ('open', 'merged', 'closed')
        )
      )
  );
$$;

comment on function public.has_valid_planning_review_evidence(text) is
  'Qualifies own evidence and evidence on direct active Sub-Issues for Deliverable review requests. Links remain on their source tasks.';
