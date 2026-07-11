drop policy if exists "task_relationship_edges_write_founders" on public.task_relationship_edges;
drop policy if exists "task_relationship_edges_insert_authorized" on public.task_relationship_edges;
drop policy if exists "task_relationship_edges_update_operational" on public.task_relationship_edges;
drop policy if exists "task_relationship_edges_delete_authorized" on public.task_relationship_edges;

create policy "task_relationship_edges_insert_authorized"
on public.task_relationship_edges for insert to authenticated
with check (
  public.current_platform_role() in ('ceo', 'deputy')
  or (
    public.current_platform_role() = 'founder'
    and relation_type = 'blocked_by'
    and created_by = public.current_profile_id()
    and exists (
      select 1
      from public.tasks as task
      left join public.packages as initiative on initiative.id = task.package_id
      where task.id = task_relationship_edges.task_id
        and task.task_type in ('deliverable', 'sub_issue')
        and (
          task.assignee = public.current_profile_id()
          or task.owner = public.current_profile_id()
          or coalesce(initiative.accountable_profile_id, initiative.owner_id) = public.current_profile_id()
        )
    )
  )
);

create policy "task_relationship_edges_update_operational"
on public.task_relationship_edges for update to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

create policy "task_relationship_edges_delete_authorized"
on public.task_relationship_edges for delete to authenticated
using (
  public.current_platform_role() in ('ceo', 'deputy')
  or (
    public.current_platform_role() = 'founder'
    and relation_type = 'blocked_by'
    and exists (
      select 1
      from public.tasks as task
      left join public.packages as initiative on initiative.id = task.package_id
      where task.id = task_relationship_edges.task_id
        and task.task_type in ('deliverable', 'sub_issue')
        and (
          task.assignee = public.current_profile_id()
          or task.owner = public.current_profile_id()
          or coalesce(initiative.accountable_profile_id, initiative.owner_id) = public.current_profile_id()
        )
    )
  )
);

notify pgrst, 'reload schema';
