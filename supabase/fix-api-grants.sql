grant usage on schema public to anon, authenticated, service_role;

grant select on profiles, projects, packages, tasks, task_dependencies, task_links, task_notes, task_activity
to authenticated, service_role;

grant insert, update, delete on profiles, projects, packages, tasks, task_dependencies, task_links, task_notes, task_activity
to authenticated, service_role;

grant usage, select on all sequences in schema public
to authenticated, service_role;
