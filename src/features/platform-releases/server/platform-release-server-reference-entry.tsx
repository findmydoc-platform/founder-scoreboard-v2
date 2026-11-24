import "server-only";

import { randomUUID } from "node:crypto";
import { after } from "next/server";
import type { PlatformReleaseReferenceEntry, PlatformReleaseReferenceEntryOutcome, PlatformReleaseReferenceKey, PlatformReleaseReferenceReceipt } from "../model/platform-release-model";
import { PlatformReleaseServerReferenceReceipt } from "../organisms/platform-release-server-reference-receipt";

type ReadResult = ({ status: "ready" } & PlatformReleaseReferenceReceipt) | { status: "forbidden" | "unavailable" | "stale" };
const unavailable = { status: "unavailable" } as const;
const forbidden = { status: "forbidden" } as const;

export function isReleaseDocumentRequest(headers: Headers) {
  return headers.get("sec-fetch-dest") === "document" && headers.get("sec-fetch-mode") === "navigate"
    && !headers.has("rsc") && !headers.has("next-router-prefetch") && !headers.has("next-router-segment-prefetch")
    && ![headers.get("purpose"), headers.get("sec-purpose")].some(value => /prefetch|prerender/i.test(value || ""));
}

export function startPlatformReleaseReferenceEntry(
  key: PlatformReleaseReferenceKey,
  session: PlatformReleaseReferenceEntry["session"],
  readActor: PlatformReleaseReferenceEntry["readActor"],
  readAuthority: PlatformReleaseReferenceEntry["readAuthority"],
  load: (options: PlatformReleaseReferenceKey & { signal: AbortSignal }) => Promise<ReadResult>,
) {
  const now = Date.now();
  if (readAuthority.userId !== session.userId || !Number.isFinite(readAuthority.deadline) || readAuthority.deadline <= now
    || readAuthority.deadline > session.expiresAt * 1_000 || !/^[a-f0-9]{64}$/.test(key.manifestDigest)) return undefined;
  const read: PlatformReleaseReferenceEntry = { id: randomUUID(), key, session, readActor, readAuthority, timeoutAt: Math.min(readAuthority.deadline, now + 15_000) };
  const controller = new AbortController();
  after(() => controller.abort());
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(0, Math.ceil(read.timeoutAt - Date.now())))]);
  let stop = () => {};
  const expired = new Promise<PlatformReleaseReferenceEntryOutcome>(resolve => {
    stop = () => resolve(Date.now() >= read.readAuthority.deadline ? forbidden : unavailable);
    if (signal.aborted) stop();
    else signal.addEventListener("abort", stop, { once: true });
  });
  const loaded = Promise.resolve().then(() => signal.aborted ? unavailable : load({ ...key, signal })).then((result): PlatformReleaseReferenceEntryOutcome => {
    if (result.status === "stale") return { status: "stale-manifest" };
    if (result.status === "forbidden") return forbidden;
    if (result.status !== "ready") return unavailable;
    const { status, ...receipt } = result;
    return { status, receipt };
  }).catch(() => unavailable);
  const result = Promise.race([loaded, expired]).finally(() => signal.removeEventListener("abort", stop));
  return { read, result };
}

function publishReferenceEntry(read: PlatformReleaseReferenceEntry, outcome: PlatformReleaseReferenceEntryOutcome): PlatformReleaseReferenceEntryOutcome {
  const now = Date.now();
  if (read.readAuthority.deadline <= now || outcome.status === "ready" && outcome.receipt.readAuthority.deadline <= now) {
    return forbidden;
  }
  if (read.timeoutAt <= now) return unavailable;
  if (outcome.status === "ready") {
    const { receipt } = outcome;
    if (receipt.version !== read.key.version || receipt.manifestDigest !== read.key.manifestDigest
      || receipt.readActor.profileId !== read.readActor.profileId || receipt.readActor.platformRole !== read.readActor.platformRole
      || receipt.readAuthority.userId !== read.readAuthority.userId || !Number.isFinite(receipt.readAuthority.deadline)
      || receipt.readAuthority.deadline > read.readAuthority.deadline || !receipt.sourceRevision || !Array.isArray(receipt.planningReferences)) {
      return unavailable;
    }
  }
  return outcome;
}

export function PlatformReleaseServerReferenceEntry({ read, result }: { read: PlatformReleaseReferenceEntry; result: Promise<PlatformReleaseReferenceEntryOutcome> }) {
  const delivery = result.then(outcome => publishReferenceEntry(read, outcome));
  return <PlatformReleaseServerReferenceReceipt id={read.id} result={delivery} />;
}
