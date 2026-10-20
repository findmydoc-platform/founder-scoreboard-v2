import "server-only";

import { observedSupabaseFetch } from "./observed-fetch";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let serviceRoleClient: SupabaseClient | null = null;

export function getServerServiceRoleSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !serviceRoleKey) return null;

  serviceRoleClient ??= createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
    global: { fetch: observedSupabaseFetch },
  });
  return serviceRoleClient;
}
