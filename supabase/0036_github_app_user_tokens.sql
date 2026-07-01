create table if not exists github_app_user_tokens (
  profile_id text primary key references profiles(id) on delete cascade,
  github_login text not null,
  github_user_id bigint,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  connected_at timestamptz not null default now(),
  refreshed_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists github_app_user_tokens_github_login_idx on github_app_user_tokens(github_login);
create index if not exists github_app_user_tokens_refresh_idx on github_app_user_tokens(refresh_token_expires_at);

grant select, insert, update, delete on github_app_user_tokens to service_role;

alter table github_app_user_tokens enable row level security;

drop policy if exists "github_app_user_tokens_no_authenticated_access" on github_app_user_tokens;

comment on table github_app_user_tokens is 'Encrypted GitHub App user token vault. Access is service-role only; never expose raw token columns to browser clients.';
