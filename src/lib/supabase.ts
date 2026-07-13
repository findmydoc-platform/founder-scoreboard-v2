import { createBrowserClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | null = null;
let serverClient: SupabaseClient | null = null;

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

export function getBrowserSupabase() {
  if (!browserSupabaseUrl || !browserSupabaseAnonKey) return null;
  browserClient ??= createBrowserClient(
    browserSupabaseUrl,
    browserSupabaseAnonKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    },
  );
  return browserClient;
}

export function getServerSupabase() {
  const url = runtimeSupabaseUrl();
  const key = runtimeEnv("SUPABASE_SERVICE_ROLE_KEY") || runtimeEnv("SUPABASE_SECRET_KEY") || runtimeSupabaseAnonKey();
  if (!url || !key) return null;
  serverClient ??= createClient(url, key, {
    auth: { persistSession: false },
  });
  return serverClient;
}

export function getSupabaseForToken(token: string) {
  const url = runtimeSupabaseUrl();
  const anonKey = runtimeSupabaseAnonKey();
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

export function requiresSupabaseAuth() {
  return runtimeEnv("REQUIRE_SUPABASE_AUTH") === "true";
}
