grant usage on schema public to anon, authenticated, service_role;

grant select on profiles, projects, packages, tasks, task_dependencies, task_links, task_notes, task_activity
to authenticated, service_role;

grant insert, update, delete on profiles, projects, task_dependencies, task_links, task_notes, task_activity
to authenticated, service_role;

revoke insert, update, delete on table public.packages, public.tasks
from public, anon, authenticated;

grant insert, update, delete on table public.packages, public.tasks
to service_role;

drop policy if exists "packages_write_members" on public.packages;
drop policy if exists "tasks_write_members" on public.tasks;

revoke all on function public.current_profile_role() from public, anon;
grant execute on function public.current_profile_role() to authenticated, service_role;

grant usage, select on all sequences in schema public
to authenticated, service_role;
