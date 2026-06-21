import { createClient } from "@supabase/supabase-js";
import { loadLocalEnv } from "./env.mjs";

function firstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

export async function createSupabaseScriptClient({
  urlEnv = ["NEXT_PUBLIC_SUPABASE_URL"],
  keyEnv = ["SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  missingMessage = "Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.",
  clientOptions = { auth: { persistSession: false } },
} = {}) {
  await loadLocalEnv();

  const url = firstEnv(urlEnv);
  const key = firstEnv(keyEnv);

  if (!url || !key) {
    console.error(missingMessage);
    process.exit(1);
  }

  return createClient(url, key, clientOptions);
}
