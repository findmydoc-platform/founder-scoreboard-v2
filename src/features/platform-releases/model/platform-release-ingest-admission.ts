import { createHash } from "node:crypto";
import { canonicalPlatformReleaseManifest, validatePlatformReleaseManifest } from "./platform-release-manifest";

export const maximumPlatformReleaseManifestBytes = 2_000_000;

export function validatePlatformReleaseIngest(value: unknown, idempotencyKey: string) {
  const validation = validatePlatformReleaseManifest(value);
  if (!validation.ok) return { ok: false as const, status: 422, error: validation.error };
  const manifest = validation.manifest;
  const computedDigest = createHash("sha256").update(canonicalPlatformReleaseManifest(manifest)).digest("hex");
  if (computedDigest !== manifest.manifestDigest) return { ok: false as const, status: 422, error: "Manifest-Digest stimmt nicht mit dem Inhalt überein." };
  if (idempotencyKey !== `platform-release:${manifest.manifestDigest}`) return { ok: false as const, status: 422, error: "Idempotency-Key stimmt nicht mit dem Manifest-Digest überein." };
  return { ok: true as const, manifest };
}
