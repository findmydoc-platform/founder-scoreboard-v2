alter table public.github_webhook_deliveries
  add column if not exists comment_id bigint,
  add column if not exists comment_node_id text,
  add column if not exists comment_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'github_webhook_deliveries_comment_metadata_check'
      and conrelid = 'public.github_webhook_deliveries'::regclass
  ) then
    alter table public.github_webhook_deliveries
      add constraint github_webhook_deliveries_comment_metadata_check
      check (
        (
          event_name = 'issue_comment'
          and comment_id is not null
          and comment_id > 0
          and nullif(trim(comment_node_id), '') is not null
          and length(comment_node_id) <= 255
          and comment_updated_at is not null
        )
        or (
          event_name <> 'issue_comment'
          and comment_id is null
          and comment_node_id is null
          and comment_updated_at is null
        )
      );
  end if;
end
$$;

create index if not exists github_webhook_deliveries_comment_idx
  on public.github_webhook_deliveries(comment_id, received_at desc)
  where comment_id is not null;

comment on column public.github_webhook_deliveries.comment_id is
  'Stable GitHub Issue comment identifier for issue_comment deliveries; null for other events.';
comment on column public.github_webhook_deliveries.comment_node_id is
  'Stable GitHub Issue comment node identifier for issue_comment deliveries; null for other events.';
comment on column public.github_webhook_deliveries.comment_updated_at is
  'GitHub Issue comment timestamp observed in the verified issue_comment delivery; null for other events.';

comment on table public.github_webhook_deliveries is
  'Verified GitHub Issue and Issue comment webhook delivery journal. Stores normalized trigger metadata and a payload hash, but no Issue or comment content.';
