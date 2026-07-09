drop policy if exists "fmd_tools_write_operational" on fmd_tools;
drop policy if exists "fmd_tools_insert_team" on fmd_tools;
drop policy if exists "fmd_tools_update_operational" on fmd_tools;
drop policy if exists "fmd_tools_update_team" on fmd_tools;
drop policy if exists "fmd_tools_delete_operational" on fmd_tools;

create policy "fmd_tools_insert_team" on fmd_tools for insert to authenticated
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy', 'viewer'));

create policy "fmd_tools_update_team" on fmd_tools for update to authenticated
using (public.current_platform_role() in ('ceo', 'founder', 'deputy', 'viewer'))
with check (public.current_platform_role() in ('ceo', 'founder', 'deputy', 'viewer'));

create policy "fmd_tools_delete_operational" on fmd_tools for delete to authenticated
using (public.current_platform_role() in ('ceo', 'deputy'));
