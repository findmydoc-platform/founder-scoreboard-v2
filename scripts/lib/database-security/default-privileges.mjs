import { addRows } from "./failures.mjs";

export async function verifyDefaultPrivileges(client, failures) {
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
}
