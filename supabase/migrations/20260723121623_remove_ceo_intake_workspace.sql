alter table public.profile_ui_preferences
  drop constraint if exists profile_ui_preferences_default_workspace_check;

update public.profile_ui_preferences
set default_workspace = 'planning'
where default_workspace = 'ceo-intake';

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
    'profile'
  ));
