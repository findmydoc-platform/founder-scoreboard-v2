create or replace function public.create_task_comment_with_github_delivery(
  p_task_id text,
  p_profile_id text,
  p_comment text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_task public.tasks%rowtype;
  v_comment public.task_comments%rowtype;
  v_status text;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task not found';
  end if;

  insert into public.task_comments (task_id, profile_id, comment)
  values (p_task_id, nullif(p_profile_id, ''), p_comment)
  returning * into v_comment;

  v_status := case
    when v_task.github_issue_number is null and coalesce(trim(v_task.issue_number), '') !~ '^[1-9][0-9]*$' then 'waiting_for_issue'
    when nullif(p_profile_id, '') is null then 'waiting_for_author_connection'
    else 'pending'
  end;

  insert into public.task_comment_github_deliveries (
    task_comment_id,
    task_id,
    author_profile_id,
    github_issue_number,
    status,
    status_reason
  ) values (
    v_comment.id,
    p_task_id,
    nullif(p_profile_id, ''),
    coalesce(
      v_task.github_issue_number,
      case when coalesce(trim(v_task.issue_number), '') ~ '^[1-9][0-9]*$' then trim(v_task.issue_number)::integer end
    ),
    v_status,
    case
      when v_status = 'waiting_for_issue' then 'github_issue_missing'
      when v_status = 'waiting_for_author_connection' then 'author_profile_missing'
      else null
    end
  );

  return jsonb_build_object(
    'comment', to_jsonb(v_comment),
    'deliveryStatus', v_status
  );
end;
$$;

revoke all on function public.create_task_comment_with_github_delivery(text, text, text) from public;
grant all on function public.create_task_comment_with_github_delivery(text, text, text) to service_role;
