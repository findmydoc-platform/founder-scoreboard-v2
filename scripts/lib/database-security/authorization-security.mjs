import {
  mappedOwnerTeamWorkweekFunctions,
  mappedOwnerTeamWorkweekReadPolicies,
  mappedTeamReadPolicies,
  planningContributorWritePolicies,
} from "./contracts.mjs";
import { addRows } from "./failures.mjs";

const mappedTeamReadPolicyMap = new Map(mappedTeamReadPolicies);
const mappedOwnerTeamWorkweekReadPolicyMap = new Map(mappedOwnerTeamWorkweekReadPolicies);
const planningContributorWritePolicySet = new Set(
  planningContributorWritePolicies,
);

export async function verifyAuthorizationSecurity(client, failures) {
  for (const signature of [
    "public.planning_deliverable_selection(text,jsonb,text,integer,integer,text,timestamptz)",
    "public.planning_selection_status(text,boolean)",
    "public.planning_deliverable_query_basis(text,jsonb,text,integer,integer,text,timestamptz,boolean)",
    "public.planning_deliverable_query_plan(text,jsonb,integer,timestamptz)",
    "public.planning_deliverable_column(text,text[],text,timestamptz,timestamptz)",
    "public.planning_deliverable_summaries(text,text[],text,timestamptz,timestamptz)",
  ]) {
    const privileges = (await client.query(`select to_regprocedure($1) is not null as present,
      has_function_privilege('anon',to_regprocedure($1),'EXECUTE') as anonymous_execute,
      has_function_privilege('authenticated',to_regprocedure($1),'EXECUTE') as user_execute,
      has_function_privilege('service_role',to_regprocedure($1),'EXECUTE') as server_execute,
      (select not prosecdef from pg_proc where oid=to_regprocedure($1)) as invoker`, [signature])).rows[0];
    if (!privileges?.present || privileges.anonymous_execute || privileges.user_execute || !privileges.server_execute || !privileges.invoker) failures.push(`Planning selection must remain invoker-only and server-executable: ${signature}`);
  }
  const publication = (await client.query(`select to_regprocedure('public.planning_board_publication_context()') is not null as present,
    has_function_privilege('anon',to_regprocedure('public.planning_board_publication_context()'),'EXECUTE') as anonymous_execute,
    has_function_privilege('authenticated',to_regprocedure('public.planning_board_publication_context()'),'EXECUTE') as user_execute,
    has_function_privilege('service_role',to_regprocedure('public.planning_board_publication_context()'),'EXECUTE') as server_execute,
    prosecdef as definer, proconfig from pg_proc where oid=to_regprocedure('public.planning_board_publication_context()')`)).rows[0];
  if (!publication?.present || publication.anonymous_execute || !publication.user_execute || publication.server_execute
    || !publication.definer || !publication.proconfig?.includes('search_path=""')) failures.push("Planning publication context must remain a fixed user-bound fence with an empty search path");
  for (const [signature, userAllowed, definer] of [
    ["public.planning_release_reference_snapshot(uuid,uuid,text,text,timestamptz,jsonb)", false, true],
    ["public.platform_release_reference_publication_context()", true, true],
    ["workspace_private.release_reference_pr_number(jsonb)", null, false],
    ["workspace_private.advance_release_reference_revision()", null, true],
  ]) {
    const entry = (await client.query(`select
      has_function_privilege('anon', procedure.oid, 'EXECUTE') as anonymous_execute,
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as user_execute,
      has_function_privilege('service_role', procedure.oid, 'EXECUTE') as server_execute,
      not exists(select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner)))
        where grantee = 0 and privilege_type = 'EXECUTE') as public_denied,
      procedure.prosecdef as definer, procedure.proconfig
      from pg_proc procedure where procedure.oid = to_regprocedure($1)`, [signature])).rows[0];
    if (!entry || entry.anonymous_execute || !entry.public_denied || entry.user_execute !== (userAllowed === true)
      || entry.server_execute !== (userAllowed === false) || entry.definer !== definer || !entry.proconfig?.includes('search_path=""')) {
      failures.push(`Release reference function violates its fixed execution boundary: ${signature}`);
    }
  }
  const releaseRevision = (await client.query(`select relation.relrowsecurity as rls,
    exists(select 1 from pg_roles as role where role.rolname in ('anon','authenticated','service_role')
      and has_table_privilege(role.oid, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as exposed
    from pg_class as relation where relation.oid=to_regclass('workspace_private.release_reference_revision')`)).rows[0];
  if (!releaseRevision?.rls || releaseRevision.exposed) failures.push("Release reference revision must remain private with RLS and no client or service table grants");
  const notificationPublication = (await client.query(`select to_regprocedure('public.notification_publication_context()') is not null as present,
    has_function_privilege('anon',to_regprocedure('public.notification_publication_context()'),'EXECUTE') as anonymous_execute,
    has_function_privilege('authenticated',to_regprocedure('public.notification_publication_context()'),'EXECUTE') as user_execute,
    has_function_privilege('service_role',to_regprocedure('public.notification_publication_context()'),'EXECUTE') as server_execute,
    prosecdef as definer, proconfig from pg_proc where oid=to_regprocedure('public.notification_publication_context()')`)).rows[0];
  if (!notificationPublication?.present || notificationPublication.anonymous_execute || !notificationPublication.user_execute || notificationPublication.server_execute
    || !notificationPublication.definer || !notificationPublication.proconfig?.includes('search_path=""')) failures.push("Notification publication context must remain a fixed user-bound fence with an empty search path");
  for (const [label, signature, serviceAllowed] of [
    ["count fast path", "public.notification_count_fast_path(uuid,uuid,text,text,timestamptz)", true],
    ["content fast path", "public.notification_content_fast_path(uuid,uuid,text,text,timestamptz,text,integer)", true],
    ["shared snapshot", "workspace_private.notification_scope_snapshot(uuid,uuid,text,text,timestamptz,text,integer)", false],
  ]) {
    const snapshot = (await client.query(`select
      has_function_privilege('anon', procedure.oid, 'EXECUTE') as anonymous_execute,
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as user_execute,
      has_function_privilege('service_role', procedure.oid, 'EXECUTE') as server_execute,
      not exists(select 1 from aclexplode(coalesce(procedure.proacl, acldefault('f', procedure.proowner)))
        where grantee = 0 and privilege_type = 'EXECUTE') as public_denied,
      procedure.prosecdef as definer, procedure.proconfig, procedure.provolatile
      from pg_proc procedure where procedure.oid = to_regprocedure($1)`, [signature])).rows[0];
    if (!snapshot || snapshot.anonymous_execute || snapshot.user_execute || snapshot.server_execute !== serviceAllowed
      || !snapshot.public_denied || snapshot.definer !== serviceAllowed || snapshot.provolatile !== "s"
      || !snapshot.proconfig?.includes('search_path=""')) failures.push(`Notification ${label} must remain read-only with restricted execution`);
  }
  const notificationRevision = (await client.query(`select relation.relrowsecurity as rls,
    exists(select 1 from pg_roles as role where role.rolname in ('anon','authenticated','service_role')
      and has_table_privilege(role.oid, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as exposed
    from pg_class as relation where relation.oid=to_regclass('workspace_private.notification_scope_revision')`)).rows[0];
  if (!notificationRevision?.rls || notificationRevision.exposed) failures.push("Notification source revision must remain private with RLS and no client or service table grants");
  for (const [signature, userAllowed] of [
    ["public.planning_detail_source(text,text)", false],
    ["public.planning_detail_publication_context(text,text)", true],
  ]) {
    const detail = (await client.query(`select
      has_function_privilege('anon', procedure.oid, 'EXECUTE') as anonymous_execute,
      has_function_privilege('authenticated', procedure.oid, 'EXECUTE') as user_execute,
      has_function_privilege('service_role', procedure.oid, 'EXECUTE') as server_execute,
      procedure.prosecdef as definer, procedure.proconfig
      from pg_proc as procedure where procedure.oid=to_regprocedure($1)`, [signature])).rows[0];
    if (!detail || detail.anonymous_execute || detail.user_execute !== userAllowed
      || detail.server_execute !== !userAllowed || !detail.definer
      || !detail.proconfig?.includes('search_path=""')) failures.push(`Detail source publication privileges differ from their fixed boundary: ${signature}`);
  }
  const detailRevision = (await client.query(`select relation.relrowsecurity as rls,
    exists(select 1 from pg_roles as role where role.rolname in ('anon','authenticated','service_role')
      and has_table_privilege(role.oid, relation.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as exposed
    from pg_class as relation where relation.oid=to_regclass('workspace_private.planning_detail_area_revision')`)).rows[0];
  if (!detailRevision?.rls || detailRevision.exposed) failures.push("Detail area revisions must remain private with RLS and no client or service table grants");
  const observationConfirmation = "public.apply_google_team_workweek_observations(uuid,integer,jsonb,timestamptz)";
  const confirmationPrivileges = await client.query(
    `select to_regprocedure($1) is not null as exists,
       has_function_privilege('service_role', to_regprocedure($1), 'EXECUTE') as server_execute`,
    [observationConfirmation],
  );
  if (!confirmationPrivileges.rows[0]?.exists || !confirmationPrivileges.rows[0]?.server_execute) {
    failures.push(`missing server-executable workweek observation confirmation: ${observationConfirmation}`);
  }

  const identityHelpers = await client.query(
    `select procedure.proname as function_name,
       procedure.proconfig,
       pg_get_functiondef(procedure.oid) as definition
     from pg_proc as procedure
     join pg_namespace as schema
       on schema.oid = procedure.pronamespace
     where schema.nspname = 'public'
       and procedure.proname = any($1::text[])
       and pg_get_function_identity_arguments(procedure.oid) = ''
     order by procedure.proname`,
    [["current_platform_role", "current_profile_id"]],
  );
  if (identityHelpers.rows.length !== 2) {
    failures.push(`expected 2 Auth identity helpers, found ${identityHelpers.rows.length}`);
  }
  for (const helper of identityHelpers.rows) {
    if (
      !helper.definition.includes("profile.auth_user_id = ( SELECT auth.uid() AS uid)")
      && !/profile\.auth_user_id\s*=\s*\(select auth\.uid\(\)\)/i.test(helper.definition)
    ) {
      failures.push(`${helper.function_name} does not bind roles to auth_user_id`);
    }
    if (/auth\.jwt|user_metadata|github_login/i.test(helper.definition)) {
      failures.push(`${helper.function_name} still trusts mutable identity metadata`);
    }
    if (!helper.proconfig?.includes('search_path=""')) {
      failures.push(`${helper.function_name} does not use an empty search_path`);
    }
  }

  const unsafeViews = await client.query(
    `select relation.relname as view_name
     from pg_class as relation
     join pg_namespace as schema on schema.oid = relation.relnamespace
     where schema.nspname = 'public'
       and relation.relkind = 'v'
       and not coalesce(
         relation.reloptions @> array['security_invoker=true'],
         false
       )
     order by relation.relname`,
  );
  addRows(
    failures,
    "public views without security_invoker",
    unsafeViews.rows,
    ["view_name"],
  );

  const unsafePolicies = await client.query(
    `select tablename, policyname, cmd
     from pg_policies
     where schemaname = 'public'
       and (
         'public'::name = any(roles)
         or 'anon'::name = any(roles)
         or lower(trim(coalesce(qual, ''))) = 'true'
         or lower(trim(coalesce(with_check, ''))) = 'true'
       )
     order by tablename, policyname`,
  );
  addRows(
    failures,
    "public, anonymous, or unconditional RLS policies",
    unsafePolicies.rows,
    ["tablename", "policyname", "cmd"],
  );

  const broadAuthenticatedSelectPolicies = await client.query(
    `select tablename, policyname, cmd
     from pg_policies
     where schemaname = 'public'
       and cmd = 'SELECT'
       and regexp_replace(
         lower(coalesce(qual, '')),
         '[[:space:]]+',
         '',
         'g'
       ) in ('auth.uid()isnotnull', '(auth.uid()isnotnull)')
     order by tablename, policyname`,
  );
  addRows(
    failures,
    "team reads granted to any authenticated session",
    broadAuthenticatedSelectPolicies.rows,
    ["tablename", "policyname"],
  );

  const mappedTeamPolicyRows = await client.query(
    `select tablename, policyname, cmd, roles::text[] as roles, qual
     from pg_policies
     where schemaname = 'public'
       and policyname = any($1::text[])
     order by tablename, policyname`,
    [[...mappedTeamReadPolicyMap.keys()]],
  );
  const mappedTeamPolicyByName = new Map(
    mappedTeamPolicyRows.rows.map((row) => [row.policyname, row]),
  );
  for (const [policyName, tableName] of mappedTeamReadPolicyMap) {
    const policy = mappedTeamPolicyByName.get(policyName);
    if (!policy) {
      failures.push(`missing mapped team read policy: ${tableName}:${policyName}`);
      continue;
    }
    if (
      policy.tablename !== tableName
      || policy.cmd !== "SELECT"
      || policy.roles.length !== 1
      || policy.roles[0] !== "authenticated"
      || !/current_profile_id\(\)\s+is\s+not\s+null/i.test(policy.qual || "")
      || /auth\.uid/i.test(policy.qual || "")
    ) {
      failures.push(`team read policy does not require a mapped profile: ${tableName}:${policyName}`);
    }
  }

  const mappedOwnerPolicyRows = await client.query(
    `select tablename, policyname, cmd, roles::text[] as roles, qual
     from pg_policies
     where schemaname = 'public'
       and policyname = any($1::text[])
     order by tablename, policyname`,
    [[...mappedOwnerTeamWorkweekReadPolicyMap.keys()]],
  );
  const mappedOwnerPolicyByName = new Map(
    mappedOwnerPolicyRows.rows.map((row) => [row.policyname, row]),
  );
  for (const [policyName, tableName] of mappedOwnerTeamWorkweekReadPolicyMap) {
    const policy = mappedOwnerPolicyByName.get(policyName);
    if (!policy) {
      failures.push(`missing mapped-owner team-workweek read policy: ${tableName}:${policyName}`);
      continue;
    }
    if (
      policy.tablename !== tableName
      || policy.cmd !== "SELECT"
      || policy.roles.length !== 1
      || policy.roles[0] !== "authenticated"
      || !/owner_profile_id/i.test(policy.qual || "")
      || !/current_profile_id\(\)/i.test(policy.qual || "")
      || /auth\.uid|current_platform_role/i.test(policy.qual || "")
    ) {
      failures.push(`team-workweek private read policy is not mapped-owner-only: ${tableName}:${policyName}`);
    }
  }

  const mappedOwnerFunctionRows = await client.query(
    `select procedure.proname as function_name,
       pg_get_functiondef(procedure.oid) as definition
     from pg_proc as procedure
     join pg_namespace as schema
       on schema.oid = procedure.pronamespace
     where schema.nspname = 'public'
       and procedure.proname = any($1::text[])
     order by procedure.proname`,
    [mappedOwnerTeamWorkweekFunctions],
  );
  for (const functionName of mappedOwnerTeamWorkweekFunctions) {
    const procedures = mappedOwnerFunctionRows.rows.filter((row) => row.function_name === functionName);
    if (!procedures.length) {
      failures.push(`missing mapped-owner team-workweek function: ${functionName}`);
      continue;
    }
    if (
      procedures.some((procedure) => !/profile\.auth_user_id\s*=\s*auth\.uid\(\)/i.test(procedure.definition)
        || /current_platform_role|platform_role|\bviewer\b/i.test(procedure.definition))
    ) {
      failures.push(`team-workweek function is not role-independent and auth-bound: ${functionName}`);
    }
  }

  const broadAuthenticatedWritePolicies = await client.query(
    `select tablename, policyname, cmd
     from pg_policies
     where schemaname = 'public'
       and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and (
         regexp_replace(
           lower(coalesce(qual, '')),
           '[[:space:]]+',
           '',
           'g'
         ) in ('auth.uid()isnotnull', '(auth.uid()isnotnull)')
         or regexp_replace(
           lower(coalesce(with_check, '')),
           '[[:space:]]+',
           '',
           'g'
         ) in ('auth.uid()isnotnull', '(auth.uid()isnotnull)')
       )
     order by tablename, policyname`,
  );
  addRows(
    failures,
    "writes granted to any authenticated session",
    broadAuthenticatedWritePolicies.rows,
    ["tablename", "policyname", "cmd"],
  );

  const contributorPolicyRows = await client.query(
    `select tablename, policyname, cmd, roles::text[] as roles, qual, with_check
     from pg_policies
     where schemaname = 'public'
       and policyname = any($1::text[])
     order by tablename, policyname`,
    [[...planningContributorWritePolicySet]],
  );
  const contributorPolicyByName = new Map(
    contributorPolicyRows.rows.map((row) => [row.policyname, row]),
  );
  for (const policyName of planningContributorWritePolicySet) {
    const policy = contributorPolicyByName.get(policyName);
    if (!policy) {
      failures.push(`missing planning contributor write policy: ${policyName}`);
      continue;
    }
    const expression = `${policy.qual || ""} ${policy.with_check || ""}`;
    if (
      policy.roles.length !== 1
      || policy.roles[0] !== "authenticated"
      || !["ceo", "founder", "deputy"].every(
        (role) => expression.includes(`'${role}'::text`),
      )
      || /viewer|auth\.uid/i.test(expression)
    ) {
      failures.push(`write policy exceeds the app planning contributor role: ${policy.tablename}:${policyName}`);
    }
  }

  const viewerWritePolicies = await client.query(
    `select tablename, policyname, cmd
     from pg_policies
     where schemaname = 'public'
       and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and (
         coalesce(qual, '') ilike '%viewer%'
         or coalesce(with_check, '') ilike '%viewer%'
       )
     order by tablename, policyname`,
  );
  addRows(
    failures,
    "RLS write policies granted to the read-only viewer role",
    viewerWritePolicies.rows,
    ["tablename", "policyname", "cmd"],
  );

  const profileWritePrivileges = await client.query(
    `with client_role(role_name) as (
       values ('anon'::name), ('authenticated'::name)
     ),
     privilege(privilege_name) as (
       values ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text)
     )
     select client_role.role_name::text, privilege.privilege_name
     from client_role
     cross join privilege
     where has_table_privilege(
       client_role.role_name,
       'public.profiles',
       privilege.privilege_name
     )
     order by client_role.role_name, privilege.privilege_name`,
  );
  addRows(
    failures,
    "client roles can mutate authorization profiles directly",
    profileWritePrivileges.rows,
    ["role_name", "privilege_name"],
  );

  const profileWritePolicy = await client.query(
    `select policyname, cmd, qual, with_check
     from pg_policies
     where schemaname = 'public'
       and tablename = 'profiles'
       and policyname = 'profiles_update_self_or_admin'`,
  );
  const profilePolicy = profileWritePolicy.rows[0];
  const normalizedProfileUsing = (profilePolicy?.qual || "")
    .toLowerCase()
    .replaceAll(/\s/g, "")
    .replaceAll("(", "")
    .replaceAll(")", "");
  const normalizedProfileCheck = (profilePolicy?.with_check || "")
    .toLowerCase()
    .replaceAll(/\s/g, "")
    .replaceAll("(", "")
    .replaceAll(")", "");
  if (
    profileWritePolicy.rowCount !== 1
    || profilePolicy.cmd !== "UPDATE"
    || normalizedProfileUsing !== "false"
    || normalizedProfileCheck !== "false"
  ) {
    failures.push("direct authenticated profile update policy is still active");
  }
}
