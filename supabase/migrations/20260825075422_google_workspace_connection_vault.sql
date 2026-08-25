create table if not exists public.google_workspace_connections (
  profile_id text primary key references public.profiles(id) on delete cascade,
  encrypted_access_token text not null,
  encrypted_refresh_token text not null,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  oauth_scopes text[] not null default array['https://www.googleapis.com/auth/calendar.events.owned']::text[],
  token_type text not null default 'Bearer',
  primary_calendar_id text not null default 'primary',
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  last_error_class text,
  updated_at timestamptz not null default now(),
  constraint google_workspace_connections_access_token_encrypted
    check (encrypted_access_token ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  constraint google_workspace_connections_refresh_token_encrypted
    check (encrypted_refresh_token ~ '^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  constraint google_workspace_connections_scope_limited
    check (oauth_scopes = array['https://www.googleapis.com/auth/calendar.events.owned']::text[]),
  constraint google_workspace_connections_bearer_only
    check (lower(token_type) = 'bearer'),
  constraint google_workspace_connections_primary_calendar_only
    check (primary_calendar_id = 'primary'),
  constraint google_workspace_connections_error_class_bounded
    check (last_error_class is null or last_error_class = any (array[
      'oauth_reconnect_required',
      'oauth_provider_unavailable',
      'oauth_scope_mismatch',
      'oauth_storage_failed'
    ]::text[]))
);

comment on table public.google_workspace_connections is
  'Encrypted Google Workspace OAuth token vault. Access is service-role only; browser and user-credential paths must not expose token columns.';

alter table public.google_workspace_connections enable row level security;

revoke all on table public.google_workspace_connections from public;
revoke all on table public.google_workspace_connections from anon;
revoke all on table public.google_workspace_connections from authenticated;
revoke all on table public.google_workspace_connections from service_role;
grant select, insert, update, delete on table public.google_workspace_connections to service_role;
