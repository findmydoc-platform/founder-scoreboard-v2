import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { canonicalPlatformReleaseManifest, validatePlatformReleaseManifest } from "@/features/platform-releases/model/platform-release-manifest";
import { loadPlatformReleases } from "@/features/platform-releases/server/platform-release-read-model-supabase";
import { requireTeamMember } from "@/lib/authz";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

const maximumManifestBytes = 2_000_000;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function secureTokenMatch(provided: string, expected: string) {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest) && Boolean(provided);
}

export async function GET(request: NextRequest) {
  const auth = await requireTeamMember(request);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return json({ ok: false, error: "Platform-Releases sind nicht verfügbar." }, 503);
  const releases = await loadPlatformReleases(supabase, auth.profile?.id || null);
  return json({ ok: true, releases });
}

export async function POST(request: NextRequest) {
  const expectedToken = process.env.FOUNDEROPS_PLATFORM_RELEASE_TOKEN || "";
  const authorization = request.headers.get("authorization") || "";
  const providedToken = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!expectedToken) return json({ ok: false, error: "Platform-Release-Ingest ist nicht konfiguriert." }, 503);
  if (!secureTokenMatch(providedToken, expectedToken)) return json({ ok: false, error: "Ungültige Zugangsdaten." }, 401);
  if (!(request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "Content-Type application/json ist erforderlich." }, 415);
  }

  const rawBody = await request.text();
  if (!rawBody || Buffer.byteLength(rawBody, "utf8") > maximumManifestBytes) {
    return json({ ok: false, error: "Manifest fehlt oder ist zu groß." }, 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "Manifest ist kein gültiges JSON." }, 400);
  }
  const validation = validatePlatformReleaseManifest(payload);
  if (!validation.ok) return json({ ok: false, error: validation.error }, 422);
  const manifest = validation.manifest;
  const computedDigest = createHash("sha256").update(canonicalPlatformReleaseManifest(manifest)).digest("hex");
  if (computedDigest !== manifest.manifestDigest) return json({ ok: false, error: "Manifest-Digest stimmt nicht mit dem Inhalt überein." }, 422);

  const expectedIdempotencyKey = `platform-release:${manifest.manifestDigest}`;
  if (request.headers.get("idempotency-key") !== expectedIdempotencyKey) {
    return json({ ok: false, error: "Idempotency-Key stimmt nicht mit dem Manifest-Digest überein." }, 422);
  }

  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return json({ ok: false, error: "Platform-Release-Ingest ist nicht verfügbar." }, 503);
  const { data, error } = await supabase.rpc("ingest_platform_release_v1", { p_manifest: manifest });
  if (error) {
    const status = error.code === "23505" ? 409 : 500;
    return json({ ok: false, error: status === 409 ? "Diese Version existiert bereits mit einem anderen Digest." : "Platform-Release konnte nicht gespeichert werden." }, status);
  }
  const replayed = Boolean((data as { replayed?: boolean } | null)?.replayed);
  const releaseUrl = new URL(`/team/platform-releases/${encodeURIComponent(manifest.version)}`, request.nextUrl.origin).toString();
  return json({ ok: true, replayed, release: { url: releaseUrl } }, replayed ? 200 : 201);
}
