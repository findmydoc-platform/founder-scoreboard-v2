alter table public.profile_ui_preferences
  drop constraint if exists profile_ui_preferences_default_workspace_check;

update public.profile_ui_preferences
set default_workspace = case
  when default_workspace = 'settings' then 'notifications'
  when default_workspace in (
    'planning',
    'backlog',
    'events',
    'sprint',
    'projects',
    'tools',
    'team',
    'notifications',
    'ceo-intake',
    'profile'
  ) then default_workspace
  else 'planning'
end
where default_workspace not in (
  'planning',
  'backlog',
  'events',
  'sprint',
  'projects',
  'tools',
  'team',
  'notifications',
  'ceo-intake',
  'profile'
);

alter table public.profile_ui_preferences
  add constraint profile_ui_preferences_default_workspace_check
  check (default_workspace in (
    'planning',
    'backlog',
    'events',
    'sprint',
    'projects',
    'tools',
    'team',
    'notifications',
    'ceo-intake',
    'profile'
  ));
