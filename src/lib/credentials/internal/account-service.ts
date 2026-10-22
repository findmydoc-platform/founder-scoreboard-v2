import { observedSupabaseFetch } from "./observed-fetch";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { WorkspaceAccessError } from "../../workspace-identity";

export function accountServiceConfiguration(strict: boolean) {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || (!strict && (
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
    )) || undefined,
  };
}

export function accountService(strict: boolean, current: () => Promise<void>, assertCurrent: () => void, configuration: ReturnType<typeof accountServiceConfiguration>) {
  if (!configuration.url || !configuration.key) return null;
  const url = configuration.url;
  const key = configuration.key;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      const target = new URL(request.url);
      if (target.origin !== new URL(url).origin || !(target.pathname.startsWith("/rest/v1/") || target.pathname.startsWith("/storage/v1/"))) {
        return Response.json({ code: "42501", message: "Keine Berechtigung für diese Aktion." }, { status: 403 });
      }
      try {
        await current();
        assertCurrent();
        const latest = accountServiceConfiguration(strict);
        if (latest.url !== url || latest.key !== key) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
      } catch (error) {
        const failure = error instanceof WorkspaceAccessError ? error : new WorkspaceAccessError(503, "workspace_access_unavailable");
        return Response.json({ code: failure.code, message: failure.message }, { status: failure.status });
      }
      return observedSupabaseFetch(request);
    } },
  });
}
