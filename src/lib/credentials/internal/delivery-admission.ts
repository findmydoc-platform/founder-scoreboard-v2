import "server-only";
import { timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WorkspaceAccessError } from "../../workspace-identity";
import { NextRequest } from "next/server";
import { authorizeSessionPolicy, administratorAccessFailure } from "./session-policy";
import type { DeliveryRestriction } from "./delivery-admission-scope";
export type DeliveryAction = "notifications.delivery.inspect" | "notifications.delivery.run" | "notifications.digest.generate" | "github.reconciliation.preview" | "github.reconciliation.deliver" | "github.preview.admit";
export type AdmissionDenial = {
  ok: false;
  status: number;
  error: string;
  code?: string;
};
export class DeliveryAdmissionDenied extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(readonly denial: AdmissionDenial) { super(denial.error); this.name = "DeliveryAdmissionDenied"; this.status = denial.status; this.code = denial.code; }
}
function secretMatches(candidate: string) {
  const expected = process.env.FOUNDEROPS_DELIVERY_SECRET?.trim() || "";
  const a = Buffer.from(candidate), b = Buffer.from(expected);
  return Boolean(candidate && expected && a.length === b.length && timingSafeEqual(a, b));
}
export function deliveryConfiguration() {
  return { url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "" };
}
export async function authorizeDeliveryAdmission(source: NextRequest, action: DeliveryAction) {
  const startedAt = Date.now();
  const request = new NextRequest(source.url, { method: source.method, headers: new Headers(source.headers) });
  const secret = action === "notifications.delivery.inspect" ? "" : request.headers.get("x-founderops-delivery-secret")?.trim() || "";
  const configuration = deliveryConfiguration();
  const assertConfiguration = () => {
    const current = deliveryConfiguration();
    if (current.url !== configuration.url || current.key !== configuration.key)
      throw new DeliveryAdmissionDenied({ ok: false, status: 503, error: "Zustellkonfiguration wurde geändert." });
  };
  if (!configuration.url || !configuration.key)
    return { ok: false as const, status: 501, error: "Supabase ist nicht konfiguriert." };
  const policy = action.startsWith("notifications.delivery.") ? "administration.technical" : "operations.lead";
  if (secret) {
    if (!secretMatches(secret))
      return { ok: false as const, status: 401, error: "Ungültiger Delivery-Secret." };
    const assert = () => {
      assertConfiguration();
      if (!secretMatches(secret))
        throw new DeliveryAdmissionDenied({ ok: false, status: 401, error: "Ungültiger Delivery-Secret." });
    };
    return { ok: true as const, mode: "pipeline" as const, profileId: null, configuration,
      assert, reassert: async () => { assert(); return assert; }, claimData: null };
  }
  const original = await authorizeSessionPolicy(request, policy, startedAt);
  if (!original.ok)
    return original;
  if (action === "github.preview.admit" && !("assertCurrent" in original))
    return { ok: false as const, status: 403, error: "Keine Berechtigung für die GitHub-Vorschau." };
  const actor = original.profile?.id || null;
  let deadline = "authority" in original && original.authority ? Date.parse(original.authority.administratorAccess.expiresAt || "") : Infinity;
  const assert = () => {
    assertConfiguration();
    if ("assertCurrent" in original)
      original.assertCurrent();
    if (Number.isFinite(deadline) && Date.now() >= deadline)
      throw new DeliveryAdmissionDenied(administratorAccessFailure({ eligible: true, active: false, expiresAt: null }));
  };
  const reassert: DeliveryRestriction = async () => {
    assert();
    const current = await authorizeSessionPolicy(request, policy, startedAt);
    if (!current.ok)
      throw new DeliveryAdmissionDenied(current);
    if ("authority" in current && current.authority) {
      const currentDeadline = Date.parse(current.authority.administratorAccess.expiresAt || "");
      if (Number.isFinite(currentDeadline))
        deadline = Math.min(deadline, currentDeadline);
    }
    if ((current.profile?.id || null) !== actor)
      throw new DeliveryAdmissionDenied({ ok: false, status: 403, error: "Zustellauftrag gehört zu einer anderen Sitzung." });
    assert();
    return assert;
  };
  return { ok: true as const, mode: "user" as const, profileId: actor, configuration, assert, reassert,
    claimData: "constrainedData" in original ? original.constrainedData(() => {
      try {
        assert();
      }
      catch (error) {
        if (error instanceof DeliveryAdmissionDenied)
          throw new WorkspaceAccessError(error.status === 503 ? 503 : 403, error.status === 503 ? "workspace_access_unavailable" : "workspace_access_denied");
        throw error;
      }
    }) : original.data };
}
export type DeliveryAdmission = Extract<Awaited<ReturnType<typeof authorizeDeliveryAdmission>>, {
  ok: true;
}>;
export function deliveryStore(admission: DeliveryAdmission): SupabaseClient {
  const { url, key } = admission.configuration;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: {
      fetch: async (input, init) => {
        try {
          const assert = await admission.reassert();
          assert();
        }
        catch (error) {
          if (error instanceof DeliveryAdmissionDenied || error instanceof WorkspaceAccessError)
            return Response.json({ message: error.message, code: "delivery_admission_denied" }, { status: error.status });
          throw error;
        }
        return fetch(input, init);
      },
    } });
}
export function bookkeepingStore(admission: DeliveryAdmission): SupabaseClient {
  const { url, key } = admission.configuration;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
