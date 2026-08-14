create table if not exists public.github_webhook_deliveries (
  delivery_id text primary key,
  event_name text not null,
  action text not null,
  installation_id bigint not null,
  repository_id bigint not null,
  repository_full_name text not null,
  issue_id bigint not null,
  issue_node_id text not null,
  issue_number integer not null,
  issue_updated_at timestamptz not null,
  sender_id bigint,
  sender_login text,
  payload_sha256 text not null,
  status text not null default 'received',
  processing_version integer not null default 1,
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  lock_token uuid,
  processed_at timestamptz,
  last_error text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint github_webhook_deliveries_delivery_id_check
    check (nullif(trim(delivery_id), '') is not null and length(delivery_id) <= 128),
  constraint github_webhook_deliveries_event_name_check
    check (nullif(trim(event_name), '') is not null and length(event_name) <= 64),
  constraint github_webhook_deliveries_action_check
    check (nullif(trim(action), '') is not null and length(action) <= 64),
  constraint github_webhook_deliveries_installation_id_check check (installation_id > 0),
  constraint github_webhook_deliveries_repository_id_check check (repository_id > 0),
  constraint github_webhook_deliveries_repository_check
    check (nullif(trim(repository_full_name), '') is not null and length(repository_full_name) <= 255),
  constraint github_webhook_deliveries_issue_id_check check (issue_id > 0),
  constraint github_webhook_deliveries_issue_node_id_check
    check (nullif(trim(issue_node_id), '') is not null and length(issue_node_id) <= 255),
  constraint github_webhook_deliveries_issue_number_check check (issue_number > 0),
  constraint github_webhook_deliveries_sender_id_check check (sender_id is null or sender_id > 0),
  constraint github_webhook_deliveries_sender_login_check
    check (sender_login is null or (nullif(trim(sender_login), '') is not null and length(sender_login) <= 255)),
  constraint github_webhook_deliveries_payload_sha256_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint github_webhook_deliveries_status_check
    check (status in ('received', 'processing', 'retry_scheduled', 'processed', 'ignored', 'failed')),
  constraint github_webhook_deliveries_processing_version_check check (processing_version >= 1),
  constraint github_webhook_deliveries_attempts_check check (attempts >= 0),
  constraint github_webhook_deliveries_lock_check check (
    (status = 'processing' and locked_at is not null and lock_token is not null)
    or (status <> 'processing' and locked_at is null and lock_token is null)
  ),
  constraint github_webhook_deliveries_processed_check check (
    (status = 'processed' and processed_at is not null)
    or (status <> 'processed' and processed_at is null)
  )
);

comment on table public.github_webhook_deliveries is
  'Verified GitHub Issue webhook delivery journal. Stores normalized trigger metadata and a payload hash, but no Issue title or body.';
comment on column public.github_webhook_deliveries.status is
  'Receipt and future projection-processing state. Receipt does not mutate FounderOps planning fields.';

create index if not exists github_webhook_deliveries_claim_idx
  on public.github_webhook_deliveries(status, available_at, received_at)
  where status in ('received', 'processing', 'retry_scheduled');

create index if not exists github_webhook_deliveries_issue_idx
  on public.github_webhook_deliveries(repository_full_name, issue_number, received_at desc);

create index if not exists github_webhook_deliveries_issue_node_idx
  on public.github_webhook_deliveries(issue_node_id, received_at desc);

alter table public.github_webhook_deliveries enable row level security;

revoke all on table public.github_webhook_deliveries from public, anon, authenticated, service_role;
grant select, insert on table public.github_webhook_deliveries to service_role;
