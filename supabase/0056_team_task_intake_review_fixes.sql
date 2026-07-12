do $$
declare
  v_signature constant text := 'public.create_team_task_intake_batch_transaction(uuid,text,uuid,text,jsonb,text,text)';
  v_old_assignment constant text := 'v_task_id := p_profile_id || ''-team-intake-'' || replace(p_idempotency_key::text, ''-'', '''') || ''-'' || v_item_index::text;';
  v_new_assignment constant text := 'v_task_id := p_profile_id || ''-team-intake-'' || replace(p_token_id::text, ''-'', '''') || ''-'' || replace(p_idempotency_key::text, ''-'', '''') || ''-'' || v_item_index::text;';
  v_definition text;
begin
  select pg_get_functiondef(v_signature::regprocedure)
  into v_definition;

  if position(v_new_assignment in v_definition) > 0 then
    return;
  end if;
  if position(v_old_assignment in v_definition) = 0 then
    raise exception 'team intake batch task id assignment is not recognized';
  end if;

  execute replace(v_definition, v_old_assignment, v_new_assignment);
end;
$$;

drop function if exists public.create_team_task_intake_token(text, text, text, text, timestamptz);

comment on function public.create_team_task_intake_batch_transaction(uuid, text, uuid, text, jsonb, text, text)
is 'Atomically revalidates Team Task Intake authority and creates a token-scoped deterministic replayable batch from a narrow intent.';

notify pgrst, 'reload schema';
