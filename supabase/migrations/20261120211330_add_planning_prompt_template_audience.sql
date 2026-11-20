create table public.planning_prompt_template_audience (
  singleton boolean primary key default true check (singleton),
  mode text not null default 'selected' check (mode in ('selected', 'all'))
);

create table public.planning_prompt_template_audience_profiles (
  profile_id text primary key references public.profiles(id) on delete cascade
);

alter table public.planning_prompt_template_audience enable row level security;
alter table public.planning_prompt_template_audience_profiles enable row level security;
revoke all on table public.planning_prompt_template_audience,
  public.planning_prompt_template_audience_profiles from public, anon, authenticated, service_role;

insert into public.planning_prompt_template_audience default values;

create function public.administrator_planning_prompt_template_audience()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.current_profile_has_active_administrator_access() then
    raise exception using errcode = '42501', message = 'active administrator access required';
  end if;

  return (
    select jsonb_build_object(
      'audience', jsonb_build_object(
        'mode', audience.mode,
        'profileIds', array(select profile_id from public.planning_prompt_template_audience_profiles order by profile_id)
      ),
      'profiles', coalesce((
        select jsonb_agg(jsonb_build_object('id', profile.id, 'name', profile.name) order by profile.name, profile.id)
        from public.profiles as profile
      ), '[]'::jsonb)
    )
    from public.planning_prompt_template_audience as audience
    where audience.singleton
  );
end;
$$;

create function public.save_planning_prompt_template_audience(p_mode text, p_profile_ids text[])
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  current_mode text;
  next_mode text;
begin
  perform public.require_active_administrator_profile();

  if (p_mode is null and p_profile_ids is null) or p_mode not in ('selected', 'all') then
    raise exception using errcode = '22023', message = 'invalid prompt template audience';
  end if;

  select audience.mode into strict current_mode
  from public.planning_prompt_template_audience as audience
  where audience.singleton
  for update;

  next_mode := coalesce(p_mode, current_mode);
  if p_profile_ids is not null then
    if next_mode <> 'selected' or exists (
      select 1 from unnest(p_profile_ids) as provided(profile_id)
      where not exists (select 1 from public.profiles as profile where profile.id = provided.profile_id)
    ) then
      raise exception using errcode = '22023', message = 'invalid prompt template audience profiles';
    end if;

    delete from public.planning_prompt_template_audience_profiles
    where profile_id <> all (p_profile_ids);

    insert into public.planning_prompt_template_audience_profiles (profile_id)
    select distinct profile_id from unnest(p_profile_ids) as provided(profile_id)
    on conflict (profile_id) do nothing;
  end if;

  if next_mode <> current_mode then
    update public.planning_prompt_template_audience set mode = next_mode where singleton;
  end if;

  return jsonb_build_object(
    'mode', next_mode,
    'profileIds', array(select profile_id from public.planning_prompt_template_audience_profiles order by profile_id)
  );
end;
$$;

create function public.planning_prompt_templates_for_profile(p_profile_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(template) order by template.kind), '[]'::jsonb)
  from public.planning_prompt_templates as template
  where exists (
    select 1
    from public.planning_prompt_template_audience as audience
    join public.profiles as profile on profile.id = p_profile_id
    where audience.singleton
      and (
        audience.mode = 'all'
        or exists (
          select 1 from public.planning_prompt_template_audience_profiles
          where profile_id = profile.id
        )
      )
  )
$$;

revoke select on table public.planning_prompt_templates from service_role;
revoke all on function public.administrator_planning_prompt_template_audience() from public, anon, authenticated, service_role;
grant execute on function public.administrator_planning_prompt_template_audience() to authenticated;
revoke all on function public.save_planning_prompt_template_audience(text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.save_planning_prompt_template_audience(text, text[]) to authenticated;
revoke all on function public.planning_prompt_templates_for_profile(text) from public, anon, authenticated, service_role;
grant execute on function public.planning_prompt_templates_for_profile(text) to service_role;
