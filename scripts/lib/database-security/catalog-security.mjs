import {
  authenticatedFunctionAllowlist,
  highRiskAuthenticatedTablePrivileges,
  sequencePrivileges,
  serviceRoleOnlyTablePrivileges,
  tablePrivileges,
} from "./contracts.mjs";
import { addRows } from "./failures.mjs";

const allowedAuthenticatedFunctions = new Set(authenticatedFunctionAllowlist);
const highRiskAuthenticatedPrivileges = new Set(
  highRiskAuthenticatedTablePrivileges,
);
const serviceRoleOnlyTablePrivilegeMap = new Map(
  serviceRoleOnlyTablePrivileges.map(([tableName, privileges]) => [
    tableName,
    new Set(privileges),
  ]),
);

export async function verifyCatalogSecurity(client, failures) {
  const tableCount = await client.query(
    `select count(*)::integer as count
     from pg_class as relation
     join pg_namespace as schema on schema.oid = relation.relnamespace
     where schema.nspname = 'public'
       and relation.relkind in ('r', 'p')`,
  );

  const tablesWithoutRls = await client.query(
    `select relation.relname as relation_name
     from pg_class as relation
     join pg_namespace as schema on schema.oid = relation.relnamespace
     where schema.nspname = 'public'
       and relation.relkind in ('r', 'p')
       and not relation.relrowsecurity
     order by relation.relname`,
  );
  addRows(failures, "public tables without RLS", tablesWithoutRls.rows, ["relation_name"]);

  const effectiveTablePrivileges = await client.query(
    `with client_role(role_name) as (
       values ('anon'::name), ('authenticated'::name)
     ),
     privilege(privilege_name) as (
       select unnest($1::text[])
     )
     select client_role.role_name::text,
       relation.relname as relation_name,
       privilege.privilege_name
     from client_role
     join pg_roles as database_role
       on database_role.rolname = client_role.role_name
     cross join pg_class as relation
     join pg_namespace as schema
       on schema.oid = relation.relnamespace
     cross join privilege
     where schema.nspname = 'public'
       and relation.relkind in ('r', 'p', 'v', 'm', 'f')
       and has_table_privilege(
         database_role.oid,
         relation.oid,
         privilege.privilege_name
       )
     order by client_role.role_name, relation.relname, privilege.privilege_name`,
    [tablePrivileges],
  );
  const anonymousTablePrivileges = effectiveTablePrivileges.rows.filter(
    (row) => row.role_name === "anon",
  );
  const unsafeAuthenticatedTablePrivileges = effectiveTablePrivileges.rows.filter(
    (row) =>
      row.role_name === "authenticated"
      && highRiskAuthenticatedPrivileges.has(row.privilege_name),
  );
  addRows(
    failures,
    "anonymous public relation privileges",
    anonymousTablePrivileges,
    ["relation_name", "privilege_name"],
  );
  addRows(
    failures,
    "authenticated RLS-bypassing relation privileges",
    unsafeAuthenticatedTablePrivileges,
    ["relation_name", "privilege_name"],
  );

  const serviceRoleOnlyTableNames = [...serviceRoleOnlyTablePrivilegeMap.keys()];
  const serviceRoleOnlyRelations = await client.query(
    `select relation.relname as relation_name
     from pg_class as relation
     join pg_namespace as schema on schema.oid = relation.relnamespace
     where schema.nspname = 'public'
       and relation.relkind in ('r', 'p')
       and relation.relname = any($1::text[])
     order by relation.relname`,
    [serviceRoleOnlyTableNames],
  );
  const existingServiceRoleOnlyTables = new Set(
    serviceRoleOnlyRelations.rows.map((row) => row.relation_name),
  );
  for (const tableName of serviceRoleOnlyTableNames) {
    if (!existingServiceRoleOnlyTables.has(tableName)) {
      failures.push(`missing service-role-only table: ${tableName}`);
    }
  }

  const serviceRoleOnlyPrivileges = await client.query(
    `with inspected_role(role_name) as (
       values ('anon'::name), ('authenticated'::name), ('service_role'::name)
     ),
     privilege(privilege_name) as (
       select unnest($1::text[])
     )
     select inspected_role.role_name::text,
       relation.relname as relation_name,
       privilege.privilege_name
     from inspected_role
     join pg_roles as database_role
       on database_role.rolname = inspected_role.role_name
     cross join pg_class as relation
     join pg_namespace as schema
       on schema.oid = relation.relnamespace
     cross join privilege
     where schema.nspname = 'public'
       and relation.relkind in ('r', 'p')
       and relation.relname = any($2::text[])
       and has_table_privilege(
         database_role.oid,
         relation.oid,
         privilege.privilege_name
       )
     order by inspected_role.role_name, relation.relname, privilege.privilege_name`,
    [tablePrivileges, serviceRoleOnlyTableNames],
  );
  const effectiveServiceRoleOnlyPrivileges = new Set(
    serviceRoleOnlyPrivileges.rows.map(
      (row) => `${row.role_name}:${row.relation_name}:${row.privilege_name}`,
    ),
  );
  for (const row of serviceRoleOnlyPrivileges.rows) {
    const allowedPrivileges = serviceRoleOnlyTablePrivilegeMap.get(row.relation_name);
    if (row.role_name !== "service_role" || !allowedPrivileges?.has(row.privilege_name)) {
      failures.push(
        `unexpected service-role-only table privilege: ${row.role_name}:${row.relation_name}:${row.privilege_name}`,
      );
    }
  }
  for (const [tableName, requiredPrivileges] of serviceRoleOnlyTablePrivilegeMap) {
    for (const privilegeName of requiredPrivileges) {
      if (!effectiveServiceRoleOnlyPrivileges.has(`service_role:${tableName}:${privilegeName}`)) {
        failures.push(`missing service-role-only table privilege: service_role:${tableName}:${privilegeName}`);
      }
    }
  }

  const serviceRoleOnlyPolicies = await client.query(
    `select tablename, policyname, cmd
     from pg_policies
     where schemaname = 'public'
       and tablename = any($1::text[])
     order by tablename, policyname`,
    [serviceRoleOnlyTableNames],
  );
  addRows(
    failures,
    "service-role-only tables with RLS policies",
    serviceRoleOnlyPolicies.rows,
    ["tablename", "policyname", "cmd"],
  );

  const effectiveSequencePrivileges = await client.query(
    `with client_role(role_name) as (
       values ('anon'::name), ('authenticated'::name)
     ),
     privilege(privilege_name) as (
       select unnest($1::text[])
     )
     select client_role.role_name::text,
       relation.relname as sequence_name,
       privilege.privilege_name
     from client_role
     join pg_roles as database_role
       on database_role.rolname = client_role.role_name
     cross join pg_class as relation
     join pg_namespace as schema
       on schema.oid = relation.relnamespace
     cross join privilege
     where schema.nspname = 'public'
       and relation.relkind = 'S'
       and has_sequence_privilege(
         database_role.oid,
         relation.oid,
         privilege.privilege_name
       )
     order by client_role.role_name, relation.relname, privilege.privilege_name`,
    [sequencePrivileges],
  );
  const unsafeSequencePrivileges = effectiveSequencePrivileges.rows.filter(
    (row) =>
      row.role_name === "anon"
      || row.privilege_name !== "USAGE",
  );
  addRows(
    failures,
    "unsafe client sequence privileges",
    unsafeSequencePrivileges,
    ["role_name", "sequence_name", "privilege_name"],
  );

  const effectiveFunctionPrivileges = await client.query(
    `with client_role(role_name) as (
       values ('anon'::name), ('authenticated'::name)
     )
     select client_role.role_name::text,
       format(
         '%I.%I(%s)',
         schema.nspname,
         procedure.proname,
         pg_get_function_identity_arguments(procedure.oid)
       ) as function_name
     from client_role
     join pg_roles as database_role
       on database_role.rolname = client_role.role_name
     cross join pg_proc as procedure
     join pg_namespace as schema
       on schema.oid = procedure.pronamespace
     where schema.nspname = 'public'
       and has_function_privilege(database_role.oid, procedure.oid, 'execute')
     order by client_role.role_name, function_name`,
  );
  const unsafeFunctionPrivileges = effectiveFunctionPrivileges.rows.filter(
    (row) =>
      row.role_name === "anon"
      || !allowedAuthenticatedFunctions.has(row.function_name),
  );
  const authenticatedFunctions = new Set(
    effectiveFunctionPrivileges.rows
      .filter((row) => row.role_name === "authenticated")
      .map((row) => row.function_name),
  );
  const missingAuthenticatedFunctions = authenticatedFunctionAllowlist
    .filter((functionName) => !authenticatedFunctions.has(functionName));
  addRows(
    failures,
    "unexpected client-executable public functions",
    unsafeFunctionPrivileges,
    ["role_name", "function_name"],
  );
  if (missingAuthenticatedFunctions.length) {
    failures.push(
      `missing authenticated RLS helpers: ${missingAuthenticatedFunctions.join(", ")}`,
    );
  }

  const unsafeSecurityDefiners = await client.query(
    `select format(
       '%I.%I(%s)',
       schema.nspname,
       procedure.proname,
       pg_get_function_identity_arguments(procedure.oid)
     ) as function_name
     from pg_proc as procedure
     join pg_namespace as schema
       on schema.oid = procedure.pronamespace
     where schema.nspname = 'public'
       and procedure.prosecdef
       and not exists (
         select 1
         from unnest(coalesce(procedure.proconfig, '{}'::text[])) as setting
         where setting like 'search_path=%'
       )
     order by function_name`,
  );
  addRows(
    failures,
    "SECURITY DEFINER functions without a fixed search_path",
    unsafeSecurityDefiners.rows,
    ["function_name"],
  );

  return {
    publicTables: Number(tableCount.rows[0]?.count || 0),
    authenticatedFunctions: authenticatedFunctions.size,
  };
}
