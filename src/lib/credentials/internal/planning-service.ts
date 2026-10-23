import { observedSupabaseFetch } from "./observed-fetch";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { AuthErrorCode } from "../../auth-error-contract";
import { WorkspaceAccessError } from "../../workspace-identity";

export class PlanningDispatchError extends Error {
  constructor(readonly status: number, readonly code: AuthErrorCode, message: string) { super(message); }
}

type Denial = { code?: string; message: string; status?: number };
function configuration(strict: boolean) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  const key = serviceKey || (!strict && (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY));
  return url && key ? { url, key } : null;
}

export function planningService(strict: boolean, beforeDispatch?: () => Promise<Denial | null>, assertCurrent?: () => void) {
  const captured = configuration(strict);
  if (!captured) return null;
  return createClient(captured.url, captured.key, { db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      try {
        const denial = beforeDispatch ? await beforeDispatch() : null;
        if (denial) return Response.json({ code: denial.code || "42501", message: denial.message }, { status: denial.status || (denial.code === "workspace_access_unavailable" ? 503 : 403) });
        assertCurrent?.();
        const active = configuration(strict);
        if (active?.url !== captured.url || active.key !== captured.key) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
        const url = new URL(request.url), expected = new URL(captured.url);
        if (url.origin !== expected.origin || !url.pathname.startsWith("/rest/v1/")) throw new WorkspaceAccessError(403, "workspace_access_denied");
        return observedSupabaseFetch(request);
      } catch (error) {
        if (error instanceof WorkspaceAccessError || error instanceof PlanningDispatchError) return Response.json({ code: error.code, message: error.message }, { status: error.status });
        return Response.json({ code: "workspace_access_unavailable", message: "Berechtigung konnte nicht geprüft werden." }, { status: 503 });
      }
    } },
  });
}
