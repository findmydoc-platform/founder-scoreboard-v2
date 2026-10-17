import "server-only";


const browserSupabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const browserSupabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function runtimeEnv(key: string) {
  return process.env[key];
}

function runtimeSupabaseUrl() {
  return runtimeEnv("NEXT_PUBLIC_SUPABASE_URL") || runtimeEnv("SUPABASE_URL");
}

function runtimeSupabaseAnonKey() {
  return (
    runtimeEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
    runtimeEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
    runtimeEnv("SUPABASE_ANON_KEY") ||
    runtimeEnv("SUPABASE_PUBLISHABLE_KEY")
  );
}

export function hasSupabaseEnv() {
  return Boolean((browserSupabaseUrl && browserSupabaseAnonKey) || (runtimeSupabaseUrl() && runtimeSupabaseAnonKey()));
}

export function requiresSupabaseAuth() {
  const localAuthDisabled = runtimeEnv("NODE_ENV") === "development"
    && runtimeEnv("VERCEL") !== "1"
    && runtimeEnv("REQUIRE_SUPABASE_AUTH") === "false";
  return !localAuthDisabled;
}
