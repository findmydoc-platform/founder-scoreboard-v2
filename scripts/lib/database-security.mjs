const authenticatedFunctionAllowlist = new Set([
  "public.current_platform_role()",
  "public.current_profile_id()",
  "public.current_profile_role()",
]);

const tablePrivileges = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
];

const highRiskAuthenticatedTablePrivileges = new Set([
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "MAINTAIN",
]);

const sequencePrivileges = ["USAGE", "SELECT", "UPDATE"];

function rowSummary(rows, fields) {
  return rows
    .slice(0, 12)
    .map((row) => fields.map((field) => row[field]).join(":"))
    .join(", ");
}

function addRows(failures, label, rows, fields) {
  if (!rows.length) return;
  failures.push(`${label}: ${rowSummary(rows, fields)}`);
}

export async function verifyDatabaseSecurity(client) {
  const failures = [];

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
      && highRiskAuthenticatedTablePrivileges.has(row.privilege_name),
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
      || !authenticatedFunctionAllowlist.has(row.function_name),
  );
  const authenticatedFunctions = new Set(
    effectiveFunctionPrivileges.rows
      .filter((row) => row.role_name === "authenticated")
      .map((row) => row.function_name),
  );
  const missingAuthenticatedFunctions = [...authenticatedFunctionAllowlist]
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

  const schemaPrivileges = await client.query(
    `select
       has_schema_privilege('anon', 'public', 'create') as anon_create,
       has_schema_privilege('authenticated', 'public', 'create') as authenticated_create`,
  );
  if (
    schemaPrivileges.rows[0]?.anon_create
    || schemaPrivileges.rows[0]?.authenticated_create
  ) {
    failures.push("client roles can CREATE objects in the public schema");
  }

  const defaultClientPrivileges = await client.query(
    `select owner.rolname as owner_name,
       defaults.defaclobjtype::text as object_type,
       case
         when privilege.grantee = 0 then 'PUBLIC'
         else grantee.rolname
       end as grantee_name,
       privilege.privilege_type
     from pg_default_acl as defaults
     join pg_roles as owner on owner.oid = defaults.defaclrole
     join pg_namespace as schema on schema.oid = defaults.defaclnamespace
     cross join lateral aclexplode(defaults.defaclacl) as privilege
     left join pg_roles as grantee on grantee.oid = privilege.grantee
     where owner.rolname = 'postgres'
       and schema.nspname = 'public'
       and (
         privilege.grantee = 0
         or grantee.rolname in ('anon', 'authenticated')
       )
     order by object_type, grantee_name, privilege.privilege_type`,
  );
  addRows(
    failures,
    "client privileges in postgres public-schema defaults",
    defaultClientPrivileges.rows,
    ["object_type", "grantee_name", "privilege_type"],
  );

  const functionDefaults = await client.query(
    `with owner as (
       select oid from pg_roles where rolname = 'postgres'
     ),
     target_schema as (
       select oid from pg_namespace where nspname = 'public'
     ),
     effective_acl as (
       select coalesce(
         (
           select defaults.defaclacl
           from pg_default_acl as defaults, owner, target_schema
           where defaults.defaclrole = owner.oid
             and defaults.defaclnamespace = target_schema.oid
             and defaults.defaclobjtype = 'f'
         ),
         acldefault('f', owner.oid)
       ) as acl
       from owner
     )
     select case
       when privilege.grantee = 0 then 'PUBLIC'
       else grantee.rolname
     end as grantee_name
     from effective_acl
     cross join lateral aclexplode(effective_acl.acl) as privilege
     left join pg_roles as grantee on grantee.oid = privilege.grantee
     where privilege.privilege_type = 'EXECUTE'
       and (
         privilege.grantee = 0
         or grantee.rolname in ('anon', 'authenticated')
       )`,
  );
  addRows(
    failures,
    "future public functions default to client EXECUTE",
    functionDefaults.rows,
    ["grantee_name"],
  );

  const previewBucket = await client.query(
    `select public, file_size_limit, allowed_mime_types
     from storage.buckets
     where id = 'fmd-tool-previews'`,
  );
  const bucket = previewBucket.rows[0];
  const allowedMimeTypes = new Set(bucket?.allowed_mime_types || []);
  if (
    previewBucket.rowCount !== 1
    || bucket.public !== true
    || Number(bucket.file_size_limit) !== 5 * 1024 * 1024
    || allowedMimeTypes.size !== 4
    || ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ].every((mimeType) => allowedMimeTypes.has(mimeType))
  ) {
    failures.push("fmd-tool-previews bucket constraints are missing or broader than expected");
  }

  const clientStorageWritePolicies = await client.query(
    `select policyname, cmd
     from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
       and (
         'public'::name = any(roles)
         or 'anon'::name = any(roles)
         or 'authenticated'::name = any(roles)
       )
     order by policyname`,
  );
  addRows(
    failures,
    "client storage write policies",
    clientStorageWritePolicies.rows,
    ["policyname", "cmd"],
  );

  if (failures.length) {
    throw new Error(
      `Database security contract failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`,
    );
  }

  return {
    publicTables: Number(tableCount.rows[0]?.count || 0),
    authenticatedFunctions: authenticatedFunctions.size,
  };
}
