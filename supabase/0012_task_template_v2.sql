alter table tasks add column if not exists problem_statement text;
alter table tasks add column if not exists intended_outcome text;
alter table tasks add column if not exists scope_constraints text;
alter table tasks add column if not exists acceptance_criteria text;
alter table tasks add column if not exists evidence_required text;
alter table tasks add column if not exists dod_template_version text default 'founder-deliverable-v2';

update tasks
set
  problem_statement = coalesce(problem_statement, description),
  intended_outcome = coalesce(intended_outcome, definition_of_done),
  acceptance_criteria = coalesce(acceptance_criteria, definition_of_done),
  evidence_required = coalesce(evidence_required, evidence_link),
  dod_template_version = coalesce(dod_template_version, 'founder-deliverable-v2')
where task_type <> 'sub_issue';
