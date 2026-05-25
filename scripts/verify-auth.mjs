import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator < 0) return null;

  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  return [key, value];
}

if (existsSync(envPath)) {
  const envFile = await readFile(envPath, "utf8");
  for (const pair of envFile.split(/\r?\n/).map(parseEnvLine)) {
    if (!pair) continue;
    const [key, value] = pair;
    process.env[key] ||= value;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase admin env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

const { data: profiles, error: profileError } = await supabase
  .from("profiles")
  .select("id,name,role,auth_user_id,github_login,platform_role,org_role")
  .order("name");

if (profileError) throw new Error(`profiles: ${profileError.message}`);

const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
if (authError) throw new Error(`auth.users: ${authError.message}`);

const authUserIds = new Set(authUsers.users.map((user) => user.id));
const authGithubLogins = new Set(
  authUsers.users
    .map((user) => user.user_metadata?.user_name || user.user_metadata?.preferred_username)
    .filter(Boolean),
);
const linked = profiles.filter((profile) => profile.auth_user_id && authUserIds.has(profile.auth_user_id));
const githubMapped = profiles.filter((profile) => profile.github_login);
const githubAuthenticated = profiles.filter((profile) => profile.github_login && authGithubLogins.has(profile.github_login));
const missingGithub = profiles.filter((profile) => !profile.github_login);
const stale = profiles.filter((profile) => profile.auth_user_id && !authUserIds.has(profile.auth_user_id));
const missingRole = profiles.filter((profile) => !profile.platform_role || !profile.org_role);
const ceos = profiles.filter((profile) => profile.platform_role === "ceo");

const result = {
  profiles: profiles.length,
  authUsers: authUsers.users.length,
  legacyAuthLinked: linked.length,
  githubMapped: githubMapped.length,
  githubAuthenticated: githubAuthenticated.length,
  ceos: ceos.map((profile) => ({ id: profile.id, name: profile.name, githubLogin: profile.github_login })),
  missingGithub: missingGithub.map((profile) => ({
    id: profile.id,
    name: profile.name,
    role: profile.role,
    platformRole: profile.platform_role,
  })),
  missingRole: missingRole.map((profile) => ({
    id: profile.id,
    name: profile.name,
    platformRole: profile.platform_role,
    orgRole: profile.org_role,
  })),
  stale: stale.map((profile) => ({
    id: profile.id,
    name: profile.name,
    role: profile.role,
    authUserId: profile.auth_user_id,
  })),
};

console.log(JSON.stringify(result, null, 2));

if (missingGithub.length || missingRole.length || stale.length || ceos.length !== 1) {
  console.error("Auth mapping is incomplete. Map every team profile with profiles.github_login, platform_role and org_role before enabling strict auth.");
  process.exit(1);
}
