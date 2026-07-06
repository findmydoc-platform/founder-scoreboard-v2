import { createSupabaseScriptClient } from "./lib/supabase.mjs";

const supabase = await createSupabaseScriptClient({
  keyEnv: ["SUPABASE_SERVICE_ROLE_KEY"],
  missingMessage: "Missing Supabase admin env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
});

const { data: profiles, error: profileError } = await supabase
  .from("profiles")
  .select("id,name,role,auth_user_id,github_login,platform_role,org_role")
  .order("name");

if (profileError) throw new Error(`profiles: ${profileError.message}`);

const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
if (authError) throw new Error(`auth.users: ${authError.message}`);

const { data: githubAppConnections, error: githubAppConnectionError } = await supabase
  .from("github_app_user_tokens")
  .select("profile_id,github_login,revoked_at,last_error");

if (githubAppConnectionError) throw new Error(`github_app_user_tokens: ${githubAppConnectionError.message}`);

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
  githubAppConnections: (githubAppConnections || []).filter((connection) => !connection.revoked_at).length,
  githubAppRevokedConnections: (githubAppConnections || []).filter((connection) => connection.revoked_at).length,
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
