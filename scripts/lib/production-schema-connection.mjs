const SESSION_POOLER_SUFFIX = ".pooler.supabase.com";

export function resolveProductionSchemaConnection(env) {
  const host = env.SUPABASE_DB_HOST?.trim();
  const user = env.SUPABASE_DB_USER?.trim();
  const password = env.SUPABASE_DB_PASSWORD;
  const database = env.SUPABASE_DB_NAME?.trim() || "postgres";

  if (!host) {
    throw new Error("Missing SUPABASE_DB_HOST for the production schema deploy.");
  }

  if (!host.endsWith(SESSION_POOLER_SUFFIX)) {
    throw new Error(
      "SUPABASE_DB_HOST must use the Supavisor session pooler because GitHub Actions cannot reach the IPv6-only direct database host.",
    );
  }

  if (!user) {
    throw new Error("Missing SUPABASE_DB_USER for the production schema deploy.");
  }

  if (!password) {
    throw new Error("Missing SUPABASE_DB_PASSWORD.");
  }

  return {
    host,
    port: 5432,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
  };
}
