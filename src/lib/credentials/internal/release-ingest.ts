import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { maximumPlatformReleaseManifestBytes, validatePlatformReleaseIngest } from "@/features/platform-releases/model/platform-release-ingest-admission";
import type { PlatformReleaseManifest } from "@/features/platform-releases/model/platform-release-manifest";
import type { ReleaseIngestCredentialInput, ReleaseIngestCredentialResult, ReleaseIngestFailure, ReleaseIngestPersistenceResult } from "../release-ingest-types";

function secureTokenMatch(provided: string, expected: string) {
  return timingSafeEqual(createHash("sha256").update(provided).digest(), createHash("sha256").update(expected).digest()) && Boolean(provided);
}
function configuration() {
  return {
    token: process.env.FOUNDEROPS_PLATFORM_RELEASE_TOKEN || "",
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "",
  };
}
function missing(): ReleaseIngestFailure { return { ok: false, status: 503, error: "Platform-Release-Ingest ist nicht konfiguriert." }; }
function denied(): ReleaseIngestFailure { return { ok: false, status: 401, error: "Ungültige Zugangsdaten." }; }
function unavailable(): ReleaseIngestFailure { return { ok: false, status: 503, error: "Platform-Release-Ingest ist nicht verfügbar." }; }

export async function authorizeReleaseIngest(input: ReleaseIngestCredentialInput): Promise<ReleaseIngestCredentialResult> {
  const action = input.action;
  if (input.credential.kind !== "release-ingest-request" || action !== "platform-release.ingest") return denied();
  const authorization = input.credential.request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const idempotencyKey = input.credential.request.headers.get("idempotency-key") || "";
  const captured = configuration();
  if (!captured.token) return missing();
  if (!secureTokenMatch(token, captured.token)) return denied();
  function current() {
    const live = configuration();
    if (!live.token) return missing();
    if (!secureTokenMatch(token, live.token) || !secureTokenMatch(captured.token, live.token)) return denied();
    if (!captured.url || !captured.key || live.url !== captured.url || live.key !== captured.key) return unavailable();
    return null;
  }
  return Object.freeze({ ok: true, ingest: Object.freeze({
    async persist(value: PlatformReleaseManifest): Promise<ReleaseIngestPersistenceResult> {
      const denial = current();
      if (denial) return denial;
      let validation: ReturnType<typeof validatePlatformReleaseIngest>;
      try {
        const snapshot = structuredClone(value);
        if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > maximumPlatformReleaseManifestBytes) return { ok: false, status: 413, error: "Manifest fehlt oder ist zu groß." };
        validation = validatePlatformReleaseIngest(snapshot, idempotencyKey);
      } catch { return { ok: false, status: 422, error: "Manifest ist ungültig." }; }
      if (!validation.ok) return validation;
      let dispatchDenial: ReleaseIngestFailure | null = null;
      const client = createClient(captured.url, captured.key, {
        db: { retry: false }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: (value, init) => {
          const request = new Request(value, init);
          const url = new URL(request.url), expected = new URL(captured.url);
          dispatchDenial = current();
          if (request.method !== "POST" || url.origin !== expected.origin || url.pathname !== "/rest/v1/rpc/ingest_platform_release_v1") dispatchDenial = unavailable();
          if (dispatchDenial) return Promise.resolve(Response.json({ message: dispatchDenial.error }, { status: dispatchDenial.status }));
          return fetch(request, { cache: "no-store", redirect: "manual" });
        } },
      });
      const result = await client.rpc("ingest_platform_release_v1", { p_manifest: validation.manifest });
      if (dispatchDenial) return dispatchDenial;
      if (result.error) return { ok: false, status: result.error.code === "23505" ? 409 : 500, error: result.error.code === "23505" ? "Diese Version existiert bereits mit einem anderen Digest." : "Platform-Release konnte nicht gespeichert werden." };
      return { ok: true, replayed: Boolean(result.data?.replayed) };
    },
  }) });
}
