create table if not exists public.task_comment_submissions (
  id uuid primary key,
  task_id text not null references public.tasks(id) on delete cascade,
  profile_id text not null references public.profiles(id) on delete cascade,
  comment text not null,
  submitted_at timestamptz not null,
  task_comment_id bigint not null unique references public.task_comments(id) on delete cascade
);
alter table public.task_comment_submissions enable row level security;
revoke all on table public.task_comment_submissions from public, anon, authenticated;
grant all on table public.task_comment_submissions to service_role;

-- Only the authorized server capability can create or inspect submission receipts.
-- The advisory lock serializes the same identity even across different tasks/actors.
create or replace function public.create_task_comment_submission(
  p_submission_id uuid, p_submitted_at timestamptz,
  p_task_id text, p_profile_id text, p_comment text, p_deliver_to_github boolean,
  p_mention_recipient_profile_ids text[] default '{}',
  p_comment_recipient_profile_ids text[] default '{}'
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_submission public.task_comment_submissions%rowtype;
  v_result jsonb;
  v_comment public.task_comments%rowtype;
  v_status text;
begin
  if p_submission_id is null or p_submitted_at is null or nullif(p_profile_id, '') is null then
    raise exception using errcode = '22023', message = 'submission identity is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_submission_id::text, 614));
  select * into v_submission from public.task_comment_submissions where id = p_submission_id;
  if found then
    if v_submission.task_id is distinct from p_task_id
      or v_submission.profile_id is distinct from p_profile_id
      or v_submission.comment is distinct from trim(p_comment)
      or v_submission.submitted_at is distinct from p_submitted_at then
      raise exception using errcode = 'P0014', message = 'submission identity conflicts with stored submission';
    end if;
    select * into strict v_comment from public.task_comments where id = v_submission.task_comment_id;
    select status into v_status from public.task_comment_github_deliveries where task_comment_id = v_comment.id;
    v_result := jsonb_build_object('comment', to_jsonb(v_comment), 'deliveryStatus', coalesce(v_status, 'not_applicable'));
  else
    v_result := public.create_task_comment_with_notifications(p_task_id, p_profile_id, p_comment, p_deliver_to_github,
      p_mention_recipient_profile_ids, p_comment_recipient_profile_ids);
    insert into public.task_comment_submissions(id, task_id, profile_id, comment, submitted_at, task_comment_id)
      values(p_submission_id, p_task_id, p_profile_id, trim(p_comment), p_submitted_at, (v_result->'comment'->>'id')::bigint);
  end if;
  return v_result || jsonb_build_object('submissionId', p_submission_id, 'submittedAt', p_submitted_at);
end;
$$;
revoke all on function public.create_task_comment_submission(uuid,timestamptz,text,text,text,boolean,text[],text[]) from public, anon, authenticated;
grant execute on function public.create_task_comment_submission(uuid,timestamptz,text,text,text,boolean,text[],text[]) to service_role;
