import type { NextRequest } from "next/server";
import { maximumPlatformReleaseManifestBytes, validatePlatformReleaseIngest } from "@/features/platform-releases/model/platform-release-ingest-admission";
import { authorizeCredentialAction } from "@/lib/credentials";
import { authzError } from "@/lib/api-response";

export const dynamic = "force-dynamic";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const auth = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "releases.read" });
  if (!auth.ok) {
    const response = authzError(auth, { ok: false });
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  const result = await auth.account.readReleases();
  if (!result.available) return json({ ok: false, error: "Platform-Releases sind nicht verfügbar." }, 503);
  const releases = result.releases;
  return json({ ok: true, releases });
}

export async function POST(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const contentType = request.headers.get("content-type") || "";
  const idempotencyKey = request.headers.get("idempotency-key") || "";
  const permission = await authorizeCredentialAction({ credential: { kind: "release-ingest-request", request }, action: "platform-release.ingest" });
  if (!permission.ok) return json({ ok: false, error: permission.error }, permission.status);
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "Content-Type application/json ist erforderlich." }, 415);
  }

  const rawBody = await request.text();
  if (!rawBody || Buffer.byteLength(rawBody, "utf8") > maximumPlatformReleaseManifestBytes) {
    return json({ ok: false, error: "Manifest fehlt oder ist zu groß." }, 413);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ ok: false, error: "Manifest ist kein gültiges JSON." }, 400);
  }
  const validation = validatePlatformReleaseIngest(payload, idempotencyKey);
  if (!validation.ok) return json({ ok: false, error: validation.error }, 422);
  const manifest = validation.manifest;
  const result = await permission.ingest.persist(manifest);
  if (!result.ok) return json({ ok: false, error: result.error }, result.status);
  const replayed = result.replayed;
  const releaseUrl = new URL(`/team/platform-releases/${encodeURIComponent(manifest.version)}`, origin).toString();
  return json({ ok: true, replayed, release: { url: releaseUrl } }, replayed ? 200 : 201);
}
