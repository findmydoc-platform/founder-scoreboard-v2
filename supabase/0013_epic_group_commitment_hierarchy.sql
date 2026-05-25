alter table packages add column if not exists milestone_id text references milestones(id) on delete set null;

create index if not exists packages_milestone_id_idx on packages(milestone_id);

update packages
set milestone_id = case
  when id in ('GC1') then 'milestone-legal-mvp'
  when id in ('GC2') then 'milestone-clinic-pipeline'
  when id in ('GC3', 'GC4', 'GC5') then 'milestone-founder-ops'
  else milestone_id
end
where milestone_id is null;

update tasks
set milestone_id = packages.milestone_id
from packages
where tasks.package_id = packages.id
  and tasks.milestone_id is null
  and packages.milestone_id is not null;
