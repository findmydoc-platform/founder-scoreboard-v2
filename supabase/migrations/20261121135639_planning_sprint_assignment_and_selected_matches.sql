-- Optional matches for the already complete Selected basis travel with the
-- Assignment page. Both use the existing selection engine in this read-only
-- statement's snapshot, with their own database admission and original limits.
create function public.planning_sprint_assignment_and_selected_matches(
  p_actor_profile_id text, p_actor_user_id uuid, p_session_id uuid, p_platform_role text,
  p_deadline timestamptz, p_sprint_id text, p_filters jsonb,
  p_selected_revision text, p_selected_evaluated_at timestamptz, p_selected_valid_until timestamptz,
  p_selected_deadline timestamptz
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  basis_current boolean := coalesce(p_selected_revision = public.planning_source_version()
    and p_selected_evaluated_at <= statement_timestamp()
    and p_selected_valid_until > statement_timestamp()
    and p_selected_deadline > statement_timestamp(), false);
  assignment jsonb;
  selected jsonb := jsonb_build_object('status','staleContinuation');
begin
  assignment := workspace_private.planning_sprint_task_selection(p_actor_profile_id,p_actor_user_id,p_session_id,p_platform_role,
    p_deadline,'assignment',p_sprint_id,p_filters,0,null,
    case when basis_current then p_selected_evaluated_at end,false);
  if assignment->>'status' = 'ready' and basis_current then
    begin
      selected := workspace_private.planning_sprint_task_selection(p_actor_profile_id,p_actor_user_id,p_session_id,p_platform_role,
        least(p_deadline,p_selected_deadline),'selected',p_sprint_id,p_filters,0,p_selected_revision,p_selected_evaluated_at,true);
    exception when insufficient_privilege then
      selected := jsonb_build_object('status','forbidden');
    when others then
      -- An independently unusable projection does not remove a valid Assignment page.
      selected := jsonb_build_object('status','unavailable');
    end;
  end if;
  return jsonb_build_object('assignment',assignment,'selected',selected);
end;
$$;
revoke all on function public.planning_sprint_assignment_and_selected_matches(text,uuid,uuid,text,timestamptz,text,jsonb,text,timestamptz,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_sprint_assignment_and_selected_matches(text,uuid,uuid,text,timestamptz,text,jsonb,text,timestamptz,timestamptz,timestamptz) to service_role;
