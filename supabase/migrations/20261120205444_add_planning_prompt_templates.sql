create table public.planning_prompt_templates (
  kind text primary key,
  text text not null check (text ~ '[^[:space:]]'),
  version integer not null default 1 check (version > 0),
  constraint planning_prompt_template_kind check (kind in ('general'))
);

alter table public.planning_prompt_templates enable row level security;
revoke all on table public.planning_prompt_templates from public, anon, authenticated, service_role;
grant select on table public.planning_prompt_templates to service_role;

insert into public.planning_prompt_templates (kind, text)
values ('general', $prompt$Schreibe Planungsitems für FounderOps in klarer, knapper Sprache. Verwende kurze Absätze und eine Liste, wenn mehrere Kriterien unabhängig voneinander prüfbar sind. Verlinke gemeinsame Standards, wenn sie als Quelle vorliegen.

Entwirf nur die ausdrücklich angefragten Items. Frage nach der Zuordnung, wenn ein erforderliches übergeordnetes Item fehlt. Übernimm belegte Vereinbarungen und verbindliche Randbedingungen. Lass unwesentliche Lücken offen und frage bei wesentlichen offenen Anforderungen nach.

Beschreibe das erwartete Ergebnis und woran es erkennbar ist. Überlasse der verantwortlichen Person die Wahl des Vorgehens, soweit keine belegte Randbedingung es festlegt. Halte die Vorschau so knapp, dass sich der Auftrag gut prüfen lässt. Speichere erst nach ausdrücklicher Freigabe.$prompt$);

create function public.administrator_planning_prompt_templates()
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
    select coalesce(jsonb_agg(to_jsonb(template) order by template.kind), '[]'::jsonb)
    from public.planning_prompt_templates as template
  );
end;
$$;

create function public.publish_planning_prompt_template(p_kind text, p_text text, p_expected_version integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  published jsonb;
begin
  perform public.require_active_administrator_profile();

  if p_kind is null or p_text is null or p_text !~ '[^[:space:]]'
    or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'invalid prompt template';
  end if;

  update public.planning_prompt_templates as template
  set text = p_text, version = template.version + 1
  where template.kind = p_kind and template.version = p_expected_version
  returning to_jsonb(template) into published;

  if published is null then
    raise exception using errcode = 'P0001', message = 'prompt template version changed';
  end if;

  return published;
end;
$$;

revoke all on function public.administrator_planning_prompt_templates() from public, anon, authenticated, service_role;
grant execute on function public.administrator_planning_prompt_templates() to authenticated;
revoke all on function public.publish_planning_prompt_template(text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.publish_planning_prompt_template(text, text, integer) to authenticated;
