create table if not exists milestones (
  id text primary key,
  project_id text not null references projects(id) on delete cascade,
  title text not null,
  description text,
  target_date date,
  status text not null default 'planned' check (status in ('planned', 'active', 'done')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table tasks add column if not exists milestone_id text references milestones(id) on delete set null;

create index if not exists milestones_project_idx on milestones(project_id, sort_order);
create index if not exists tasks_milestone_id_idx on tasks(milestone_id);

grant select, insert, update, delete on milestones to authenticated, service_role;

alter table milestones enable row level security;

drop policy if exists "milestones_select_team" on milestones;
create policy "milestones_select_team" on milestones for select to authenticated using (auth.uid() is not null);

drop policy if exists "milestones_write_operational" on milestones;
create policy "milestones_write_operational" on milestones for all to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'))
with check (public.current_platform_role() in ('ceo', 'deputy'));

insert into milestones (id, project_id, title, description, target_date, status, sort_order)
values
  ('milestone-legal-mvp', 'findmydoc-founder-execution', 'MVP & Legal Ready', 'MVP, Marken-/Legal-Guardrails und belastbare Go-Live-Grundlage.', '2026-06-07', 'active', 10),
  ('milestone-clinic-pipeline', 'findmydoc-founder-execution', 'Klinikpipeline & Outreach Ready', 'Prospects, CRM-Struktur und Outreach-Materialien für die ersten Klinikgespräche.', '2026-06-21', 'planned', 20),
  ('milestone-founder-ops', 'findmydoc-founder-execution', 'Founder Ops & Funding Ready', 'Founder-Rhythmus, Funding-Unterlagen, Evidence und Entscheidungslogik stabilisieren.', '2026-06-30', 'planned', 30)
on conflict (id) do update set
  title = excluded.title,
  description = excluded.description,
  target_date = excluded.target_date,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

update tasks
set milestone_id = case
  when package_id in ('GC1', 'GC3') then 'milestone-legal-mvp'
  when package_id in ('GC2') then 'milestone-clinic-pipeline'
  else 'milestone-founder-ops'
end
where milestone_id is null;
