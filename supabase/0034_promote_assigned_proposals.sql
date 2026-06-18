with promoted as (
  update tasks
  set
    task_type = 'deliverable',
    score_relevant = true,
    github_sync_status = 'not_synced',
    github_sync_error = null
  where task_type = 'proposal'
    and status <> 'Vorschlag'
    and owner is not null
    and assignee is not null
    and package_id is not null
    and sprint_id is not null
  returning id
)
insert into task_activity (task_id, message)
select id, 'Aufgabenvorschlag zu Deliverable konvertiert'
from promoted;
