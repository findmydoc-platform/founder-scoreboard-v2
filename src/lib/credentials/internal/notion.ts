import { observedSupabaseFetch } from "./observed-fetch";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { headers } from "next/headers";
import { getServerAuthSupabase } from "./cookie-client";
import { authorizeSessionData } from "./session";
import { requiresSupabaseAuth } from "../../supabase-configuration";
import { isLocalLoginRequestAllowed } from "../../local-development-auth";
import { loadPlanningHeaderData } from "../../planning-header-data";
import { planningHeaderSlotLoaders } from "./planning-header-cache";
import type { DecisionLogCredentialInput, DecisionLogCredentialResult, NotionDecisionLogCapability } from "../notion-types";

function configuration() {
  return {
    token: process.env.NOTION_DECISION_LOG_TOKEN?.trim() || "",
    source: (process.env.NOTION_DECISION_LOG_DATA_SOURCE_ID || "").replace(/^collection:\/\//, "").trim(),
    enabled: process.env.NOTION_DECISION_LOG_ENABLED !== "false",
  };
}
function serviceConfiguration() {
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "",
  };
}
function forbidden() { return { ok: false as const, status: 403, error: "Keine Berechtigung für das Decision Log." }; }
function unavailable() { return new Error("Decision Log ist gerade nicht verfügbar."); }

export async function authorizeDecisionLog(input: DecisionLogCredentialInput): Promise<DecisionLogCredentialResult> {
  const startedAt = Date.now();
  let resourceDeadline: number | null = null;
  const action = input.action;
  const kind = input.credential.kind;
  const configured = configuration();
  const dataConfiguration = serviceConfiguration();
  if (action !== "decision-log.read" || kind !== "server-cookies") return forbidden();
  const requestHeaders = new Headers(await headers());
  const local = !requiresSupabaseAuth();
  if (!local) {
    const client = await getServerAuthSupabase();
    const session = client ? await client.auth.getSession() : null;
    if (session?.error || !session?.data.session?.access_token) return { ok: false, status: 401, error: "Anmeldung erforderlich." };
    requestHeaders.set("authorization", `Bearer ${session.data.session.access_token}`);
  } else if (!isLocalLoginRequestAllowed(requestHeaders.get("host") || "")) return forbidden();
  const request = { headers: requestHeaders, method: "GET" } as NextRequest;
  const permission = local ? null : await authorizeSessionData(request, "session.planning", startedAt);
  if (permission && !permission.ok) return permission;
  const actor = permission?.ok ? Object.freeze({ ...permission.profile }) : null;
  const userId = permission?.ok ? permission.user.id : null;
  const assertOriginal = () => {
    if (permission?.ok) permission.assertCurrent();
    if (requiresSupabaseAuth() === local) throw unavailable();
  };
  async function current() {
    assertOriginal();
    if (local) return () => assertOriginal();
    const live = await authorizeSessionData(request, "session.planning", startedAt);
    if (!live.ok || live.user.id !== userId || live.profile.id !== actor?.id || live.profile.platformRole !== actor?.platformRole) throw unavailable();
    return () => { assertOriginal(); live.assertCurrent(); };
  }
  const assertNotion = () => {
    const live = configuration();
    if (live.token !== configured.token || live.source !== configured.source || live.enabled !== configured.enabled
      || (resourceDeadline !== null && Date.now() >= resourceDeadline)) throw unavailable();
  };
  const assertData = () => {
    const live = serviceConfiguration();
    if (live.url !== dataConfiguration.url || live.key !== dataConfiguration.key) throw unavailable();
  };
  if (!dataConfiguration.url || !dataConfiguration.key) return { ok: false, status: 503, error: "Decision Log ist gerade nicht verfügbar." };
  // This client remains private and can only serve the existing fixed header loader.
  const service = createClient(dataConfiguration.url, dataConfiguration.key, {
    db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (value, init) => {
      const outgoing = new Request(value, init);
      try {
        const assertCurrent = await current();
        const url = new URL(outgoing.url), expected = new URL(dataConfiguration.url);
        if (url.origin !== expected.origin || !url.pathname.startsWith("/rest/v1/")) throw unavailable();
        assertCurrent(); assertData();
        return observedSupabaseFetch(outgoing);
      } catch { return Response.json({ message: "Decision Log ist gerade nicht verfügbar." }, { status: 403 }); }
    } },
  });
  const notion: NotionDecisionLogCapability | null = configured.enabled && configured.token && configured.source ? Object.freeze({
    async queryPage(cursor = "") {
      if (typeof cursor !== "string") throw unavailable();
      const deadline = resourceDeadline ??= Date.now() + 15000;
      const body = JSON.stringify({ page_size: 100, sorts: [{ property: "Datum", direction: "descending" }], ...(cursor ? { start_cursor: cursor } : {}) });
      const assertCurrent = await current();
      assertNotion();
      const requestDeadline = Math.min(Date.now() + 8000, deadline);
      const signal = AbortSignal.timeout(requestDeadline - Date.now());
      assertCurrent(); assertNotion();
      const response = await fetch(`https://api.notion.com/v1/data_sources/${encodeURIComponent(configured.source)}/query`, {
        method: "POST", headers: { Authorization: `Bearer ${configured.token}`, "Content-Type": "application/json", "Notion-Version": "2026-03-11" },
        body,
        cache: "no-store", redirect: "manual", signal,
      });
      const payload: unknown = response.ok ? await response.json().catch(() => null) : null;
      assertCurrent(); assertNotion();
      if (Date.now() >= requestDeadline) throw unavailable();
      return { ok: response.ok, payload };
    },
  }) : null;
  try {
    const assertCurrent = await current();
    assertCurrent(); assertData(); assertNotion();
  } catch { return { ok: false, status: 503, error: "Decision Log ist gerade nicht verfügbar." }; }
  return Object.freeze({ ok: true, profile: actor, notion, async loadHeader() {
    const assertCurrent = await current();
    assertCurrent(); assertData();
    const result = await loadPlanningHeaderData(service, { currentProfileId: actor?.id || null, platformRole: actor?.platformRole || null, sharedSlotLoaders: planningHeaderSlotLoaders(service) });
    const assertFinished = await current();
    assertFinished(); assertData();
    return result;
  } });
}
