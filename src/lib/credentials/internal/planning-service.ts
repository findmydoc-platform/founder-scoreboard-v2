import { observedSupabaseFetch } from "./observed-fetch";
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

export function planningService(strict: boolean, beforeDispatch?: () => Promise<Denial | null>, assertCurrent?: () => void, operationSignal?: AbortSignal) {
  const captured = configuration(strict);
  if (!captured) return null;
  return createClient(captured.url, captured.key, { db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const request = new Request(input, init);
      const signal = operationSignal ? AbortSignal.any([operationSignal, request.signal]) : undefined;
      try {
        signal?.throwIfAborted();
        const denial = beforeDispatch ? await beforeDispatch() : null;
        if (denial) return Response.json({ code: denial.code || "42501", message: denial.message }, { status: denial.status || (denial.code === "workspace_access_unavailable" ? 503 : 403) });
        assertCurrent?.();
        signal?.throwIfAborted();
        const active = configuration(strict);
        if (active?.url !== captured.url || active.key !== captured.key) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
        const url = new URL(request.url), expected = new URL(captured.url);
        if (url.origin !== expected.origin || !url.pathname.startsWith("/rest/v1/")) throw new WorkspaceAccessError(403, "workspace_access_denied");
        // Keep the SDK's explicit operation signal through framework fetch wrappers.
        // Request inputs still use the normalized request because construction can transfer their body.
        return input instanceof Request
          ? signal ? observedSupabaseFetch(request, { signal }) : observedSupabaseFetch(request)
          : observedSupabaseFetch(input, signal ? { ...init, signal } : init);
      } catch (error) {
        if (error instanceof WorkspaceAccessError || error instanceof PlanningDispatchError) return Response.json({ code: error.code, message: error.message }, { status: error.status });
        return Response.json({ code: "workspace_access_unavailable", message: "Berechtigung konnte nicht geprüft werden." }, { status: 503 });
      }
    } },
  });
}

// The user-bound dispatch already checks the original JWT, Workspace binding
// and permit. Read its live profile and source together instead of following
// the profile check with another privileged source-only dispatch.
export function planningPublicationSource(data: SupabaseClient | null, profile: { id: string; platformRole: string } | null, assertCurrent: () => void, detail?: { itemId: string; area: import("@/features/tasks/model/task-detail-read-model").TaskDetailReadArea }) {
  const captured = configuration(false);
  if (!data || !profile || !captured) return undefined;
  return { async read(signal?: AbortSignal) {
    try {
      assertCurrent();
      if (signal?.aborted) return { status: "unavailable" as const };
      const assertEnvironment = () => {
        const active = configuration(false);
        if (active?.url !== captured.url || active.key !== captured.key) throw new WorkspaceAccessError(503, "workspace_access_unavailable");
      };
      assertEnvironment();
      const read = detail ? data.rpc("planning_detail_publication_context", { p_item_id: detail.itemId, p_area: detail.area }) : data.rpc("planning_board_publication_context");
      const result = await (signal ? read.abortSignal(signal) : read);
      assertCurrent();
      assertEnvironment();
      if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" as const : "unavailable" as const };
      if (signal?.aborted) return { status: "unavailable" as const };
      if (!result.data || result.data.profile_id !== profile.id || result.data.platform_role !== profile.platformRole) return { status: "forbidden" as const };
      if (typeof result.data.source_revision !== "string") return { status: "unavailable" as const };
      return { status: "ready" as const, revision: result.data.source_revision };
    } catch (error) {
      return { status: error instanceof WorkspaceAccessError || error instanceof PlanningDispatchError
        ? error.status === 401 || error.status === 403 ? "forbidden" as const : "unavailable" as const
        : "unavailable" as const };
    }
  } };
}
