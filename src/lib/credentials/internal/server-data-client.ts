import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
let serverClient: SupabaseClient | null = null;
function runtimeEnv(key: string) { return process.env[key]; }
function runtimeSupabaseUrl() { return runtimeEnv("NEXT_PUBLIC_SUPABASE_URL") || runtimeEnv("SUPABASE_URL"); }
function runtimeSupabaseAnonKey() { return runtimeEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") || runtimeEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") || runtimeEnv("SUPABASE_ANON_KEY") || runtimeEnv("SUPABASE_PUBLISHABLE_KEY"); }
export function getServerSupabase() {
  const url = runtimeSupabaseUrl();
  const key = runtimeEnv("SUPABASE_SERVICE_ROLE_KEY") || runtimeEnv("SUPABASE_SECRET_KEY") || runtimeSupabaseAnonKey();
  if (!url || !key) return null;
  serverClient ??= createClient(url, key, {
    auth: { persistSession: false },
  });
  return serverClient;
}
