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
    [["current_platform_role", "current_profile_id", "current_profile_role"]],
  );
  if (identityHelpers.rows.length !== 3) {
    failures.push(`expected 3 Auth identity helpers, found ${identityHelpers.rows.length}`);
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
      || /auth\.uid|current_platform_role|current_profile_role/i.test(policy.qual || "")
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
  const mappedOwnerFunctionByName = new Map(
    mappedOwnerFunctionRows.rows.map((row) => [row.function_name, row]),
  );
  for (const functionName of mappedOwnerTeamWorkweekFunctions) {
    const procedure = mappedOwnerFunctionByName.get(functionName);
    if (!procedure) {
      failures.push(`missing mapped-owner team-workweek function: ${functionName}`);
      continue;
    }
    if (
      !/profile\.auth_user_id\s*=\s*auth\.uid\(\)/i.test(procedure.definition)
      || /current_platform_role|current_profile_role|platform_role|\bviewer\b/i.test(procedure.definition)
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
      || /viewer|auth\.uid|current_profile_role/i.test(expression)
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
