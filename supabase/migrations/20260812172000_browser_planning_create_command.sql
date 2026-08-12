-- Browser strategic creation remains a session-authenticated transport, while
-- the service-only command transaction revalidates the authoritative actor.
create or replace function public.create_browser_planning_item_transaction(
  p_item jsonb,
  p_strategy jsonb,
  p_raci_assignments jsonb,
  p_actor_profile_id text,
  p_request_ip text default null,
  p_user_agent text default null,
  p_legacy_audit_action text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor_role text;
  v_result jsonb;
begin
  select platform_role
  into v_actor_role
  from public.profiles
  where id = p_actor_profile_id;

  if v_actor_role not in ('ceo', 'deputy') then
    raise exception using errcode = 'P0006', message = 'planning create requires an operational lead';
  end if;

  v_result := public.create_planning_item_transaction(
    p_item,
    p_strategy,
    coalesce(p_raci_assignments, '[]'::jsonb),
    p_actor_profile_id
  );

  if nullif(p_legacy_audit_action, '') is not null then
    insert into public.audit_log (
      actor_profile_id,
      action,
      entity_type,
      entity_id,
      after_data,
      request_ip,
      user_agent
    ) values (
      p_actor_profile_id,
      p_legacy_audit_action,
      'milestone',
      v_result->'task'->>'id',
      v_result->'task',
      p_request_ip,
      p_user_agent
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.create_browser_planning_item_transaction(jsonb, jsonb, jsonb, text, text, text, text) from public;
grant execute on function public.create_browser_planning_item_transaction(jsonb, jsonb, jsonb, text, text, text, text) to service_role;
