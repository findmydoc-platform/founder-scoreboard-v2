-- The application reads Notion and exposes no action on these retired local tables.
-- Preserve their data, foreign keys, RLS and existing service-role privileges.
revoke all privileges on table
  public.decision_log,
  public.decision_comments,
  public.decision_confirmations,
  public.decision_task_links
from public, anon, authenticated;

revoke all privileges on sequence
  public.decision_log_id_seq,
  public.decision_comments_id_seq,
  public.decision_confirmations_id_seq,
  public.decision_task_links_id_seq
from public, anon, authenticated;

drop policy if exists decision_log_select_team on public.decision_log;
drop policy if exists decision_log_write_ceo on public.decision_log;
drop policy if exists decision_comments_select_team on public.decision_comments;
drop policy if exists decision_comments_insert_team on public.decision_comments;
drop policy if exists decision_confirmations_select_team on public.decision_confirmations;
drop policy if exists decision_confirmations_insert_team on public.decision_confirmations;
drop policy if exists decision_task_links_select_team on public.decision_task_links;
drop policy if exists decision_task_links_write_team on public.decision_task_links;
