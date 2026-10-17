import type { NextRequest } from "next/server";
import type { PlatformReleaseManifest } from "@/features/platform-releases/model/platform-release-manifest";

export type ReleaseIngestFailure = { ok: false; status: number; error: string };
export type ReleaseIngestPersistenceResult = ReleaseIngestFailure | { ok: true; replayed: boolean };
export type ReleaseIngestCredentialInput = { credential: { kind: "release-ingest-request"; request: NextRequest }; action: "platform-release.ingest" };
export type ReleaseIngestCredentialResult = ReleaseIngestFailure | {
  ok: true;
  ingest: Readonly<{ persist(manifest: PlatformReleaseManifest): Promise<ReleaseIngestPersistenceResult> }>;
};
