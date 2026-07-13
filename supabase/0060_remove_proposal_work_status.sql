-- Proposal state belongs to approval_status, never to the operational task status.
update public.tasks
set status = 'Offen'
where status = 'Vorschlag';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'tasks_status_not_proposal_check'
      and conrelid = 'public.tasks'::regclass
  ) then
    alter table public.tasks
      add constraint tasks_status_not_proposal_check
      check (status <> 'Vorschlag') not valid;
  end if;
end
$$;

alter table public.tasks validate constraint tasks_status_not_proposal_check;

notify pgrst, 'reload schema';
