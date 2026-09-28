export async function verifyWorkspaceSecurity(client, failures) {
  const hook = await client.query("select rolconfig from pg_roles where rolname='authenticator'");
  if (!hook.rows[0]?.rolconfig?.includes("pgrst.db_pre_request=public.workspace_check_request")) failures.push("Workspace Data API pre-request hook missing");
  const missing = await client.query(`select distinct tablename from pg_policies source
    where schemaname='public' and 'authenticated'::name=any(roles) and permissive='PERMISSIVE'
      and not exists(select 1 from pg_policies boundary where boundary.schemaname=source.schemaname
        and boundary.tablename=source.tablename and boundary.policyname='workspace_request_boundary'
        and boundary.permissive='RESTRICTIVE' and boundary.cmd='ALL'
        and boundary.qual like '%workspace_request_admitted()%'
        and boundary.with_check like '%workspace_request_admitted()%')`);
  if (missing.rowCount) failures.push(`Missing Workspace table boundaries: ${missing.rows.map(row => row.tablename).join(", ")}`);
  const privateAccess = await client.query(`select role_name from (values ('anon'),('authenticated')) roles(role_name)
    where has_schema_privilege(role_name,'workspace_private','USAGE')`);
  if (privateAccess.rowCount) failures.push("Workspace permit and identity storage exposed to user roles");
  const channels = await client.query(`select policyname from pg_policies where schemaname='realtime'
    and tablename='messages' and cmd in ('SELECT','ALL')`);
  if (channels.rowCount) failures.push("Realtime message access requires a separate Workspace authorization design");
}
