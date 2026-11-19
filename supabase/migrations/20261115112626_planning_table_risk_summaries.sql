-- Table risks use the complete compatible relationship and attention basis.
-- They do not compute Board child progress or return endpoint content.
create or replace function public.planning_table_risks(
  p_actor_profile_id text, p_selected_ids text[], p_source_revision text,
  p_evaluated_at timestamptz, p_valid_until timestamptz default null
) returns jsonb language sql stable security invoker set search_path = '' as $$
with
basis as (select public.planning_source_version() as revision),
chosen as materialized (
  select item.* from public.active_tasks item
  where item.project_id='findmydoc-founder-execution' and item.task_type='deliverable'
    and item.id=any(p_selected_ids)
),
directed as materialized (
  select item.id,
    case when edge.task_id=item.id and edge.relation_type='blocked_by'
      or edge.related_task_id=item.id and edge.relation_type='blocks' then 'waitsOn'
      when edge.task_id=item.id and edge.relation_type='blocks'
      or edge.related_task_id=item.id and edge.relation_type='blocked_by' then 'blocks'
      else 'related' end as direction,
    (case when linked.task_type='sub_issue' then public.planning_selection_status(linked.status,true)
      else coalesce(nullif(linked.status,''),'Offen') end)<>'Erledigt' as is_open
  from chosen item join public.task_relationship_edges edge on item.id in (edge.task_id,edge.related_task_id)
  join public.active_tasks linked on linked.id=case when edge.task_id=item.id then edge.related_task_id else edge.task_id end
    and linked.project_id='findmydoc-founder-execution'
  where edge.task_id<>edge.related_task_id
),
waiting as materialized (select distinct id from directed where direction='waitsOn' and is_open),
attention as (
  select item.id,
    coalesce((select jsonb_agg(signal.id order by signal.ordinal) from (values
      (1,'owner-missing',item.task_type='deliverable' and item.priority='P0' and coalesce(nullif(item.assignee,''),nullif(item.owner,''),'')=''),
      (2,'blocker-missing',public.planning_selection_status(item.status)='Blockiert' and not exists(select 1 from public.task_blockers blocker where blocker.task_id=item.id and blocker.status='open')),
      (3,'waiting',exists(select 1 from waiting where waiting.id=item.id)),
      (4,'sync-failed',item.task_type='deliverable' and item.github_issue_sync_status='failed'),
      -- ECMAScript trim whitespace, including NBSP and BOM, is significant to
      -- the established AC/DoD predicates. Profile identities are never trimmed.
      (5,'acceptance-criteria-missing',item.task_type='deliverable' and btrim(coalesce(item.acceptance_criteria,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')=''),
      (6,'definition-of-done-missing',item.task_type='deliverable' and btrim(coalesce(item.definition_of_done,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='')
    ) signal(ordinal,id,present) where signal.present),'[]'::jsonb) as signal_ids,
    item.task_type='deliverable' and coalesce(item.sprint_id,'')<>'' and public.planning_selection_status(item.status)<>'Erledigt'
      and coalesce(item.evidence_link,'')='' and coalesce(item.github_issue_url,'')='' and coalesce(item.issue_url,'')='' as evidence_required
  from chosen item
)
select case
  when not exists(select 1 from public.profiles where id=p_actor_profile_id and platform_role in ('ceo','deputy','founder','viewer'))
    then jsonb_build_object('status','forbidden')
  when p_source_revision is null or p_source_revision<>basis.revision or p_evaluated_at is null
    or p_valid_until<=statement_timestamp() or cardinality(p_selected_ids) is null
    or cardinality(p_selected_ids)>120 or (select count(*) from chosen)<>cardinality(p_selected_ids)
    then jsonb_build_object('status','staleContinuation')
  else jsonb_build_object(
    'status','ready','source_revision',basis.revision,'evaluated_at',p_evaluated_at,
    'relations',coalesce((select jsonb_object_agg(item.id,jsonb_build_object(
      'waitsOn',(select count(*) from directed where id=item.id and direction='waitsOn'),
      'blocks',(select count(*) from directed where id=item.id and direction='blocks'),
      'hasOpenWait',exists(select 1 from waiting where id=item.id)
    )) from chosen item),'{}'::jsonb),
    'attention_inputs',coalesce((select jsonb_object_agg(attention.id,jsonb_build_object(
      'signal_ids',attention.signal_ids,'evidence_required',attention.evidence_required,
      'evidence_urls',case when attention.evidence_required then coalesce((select jsonb_agg(link.url) from public.task_links link where link.task_id=attention.id and link.type='evidence'),'[]'::jsonb) else '[]'::jsonb end
    )) from attention),'{}'::jsonb)
  ) end from basis;
$$;
revoke all on function public.planning_table_risks(text,text[],text,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.planning_table_risks(text,text[],text,timestamptz,timestamptz) to service_role;
comment on function public.planning_table_risks(text,text[],text,timestamptz,timestamptz) is
  'Complete directed relation counts and Planning attention inputs for selected Table rows on their original source/time basis; no child progress or Item content.';
