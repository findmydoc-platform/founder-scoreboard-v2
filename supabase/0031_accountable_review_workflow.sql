alter table tasks add column if not exists review_owner_profile_id text references profiles(id) on delete set null;
alter table tasks add column if not exists review_requested_at timestamptz;

create index if not exists tasks_review_owner_profile_id_idx on tasks(review_owner_profile_id);
create index if not exists tasks_review_requested_at_idx on tasks(review_requested_at);

comment on column tasks.review_owner_profile_id is 'Frozen review owner for an active task review request, usually the Initiative Accountable.';
comment on column tasks.review_requested_at is 'Timestamp when the current task review request was opened or renewed.';

notify pgrst, 'reload schema';
