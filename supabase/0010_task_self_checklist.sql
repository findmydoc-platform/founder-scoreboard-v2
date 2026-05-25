alter table tasks add column if not exists self_dod_checked boolean not null default false;
alter table tasks add column if not exists self_evidence_checked boolean not null default false;
alter table tasks add column if not exists self_documented_checked boolean not null default false;
alter table tasks add column if not exists self_blockers_checked boolean not null default false;
