import "server-only";

import { randomUUID } from "node:crypto";
import { Suspense } from "react";
import { after } from "next/server";
import { PlanningServerNotificationReceipt } from "../organisms/planning-server-notification-receipt";
import type { NotificationCountReceipt, NotificationInboxReceipt, NotificationPreviewReceipt, NotificationEntryRead, NotificationEntryResults } from "../model/planning-notifications-state";

type ScopeResult = ({ status: "ready" } & (NotificationInboxReceipt | NotificationCountReceipt | NotificationPreviewReceipt)) | {
  status: "forbidden" | "unavailable" | "staleContinuation";
};

export function isNotificationDocumentRequest(headers: Headers) {
  return headers.get("sec-fetch-dest") === "document" && headers.get("sec-fetch-mode") === "navigate"
    && !headers.get("rsc") && !headers.has("next-router-prefetch") && !headers.has("next-router-segment-prefetch")
    && !headers.get("purpose")?.includes("prefetch") && !headers.get("sec-purpose")?.includes("prefetch");
}

export function startPlanningServerNotificationEntry(
  session: NotificationEntryRead["session"],
  readAuthority: NotificationEntryRead["readAuthority"],
  load: (scope: "inbox" | "count", options: { signal: AbortSignal }) => Promise<ScopeResult>,
) {
  const now = Date.now();
  if (readAuthority.userId !== session.userId || !Number.isFinite(readAuthority.deadline) || readAuthority.deadline <= now
    || readAuthority.deadline > session.expiresAt * 1_000) return undefined;
  const read: NotificationEntryRead = { id: randomUUID(), session, readAuthority, timeoutAt: Math.min(readAuthority.deadline, now + 15_000) };
  const controller = new AbortController();
  after(() => controller.abort());
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(0, Math.ceil(read.timeoutAt - Date.now())))]);
  const unavailable = { status: "unavailable" } as const;
  function bounded<T>(load: Promise<T>) {
    const result = load.catch(() => unavailable);
    if (signal.aborted) return Promise.resolve(unavailable);
    let stop: () => void = () => undefined;
    // A provider abort is best effort. Still settle each Suspense result by its original deadline.
    const timeout = new Promise<typeof unavailable>(resolve => {
      stop = () => resolve(unavailable);
      signal.addEventListener("abort", stop, { once: true });
    });
    return Promise.race([result, timeout]).finally(() => signal.removeEventListener("abort", stop));
  }
  const results: NotificationEntryResults = {
    inbox: bounded(load("inbox", { signal }).then(result => result.status === "ready" && "events" in result
      ? { status: "ready" as const, receipt: result } : result.status === "forbidden" ? { status: "forbidden" as const } : unavailable)),
    count: bounded(load("count", { signal }).then(result => result.status === "ready" && "unreadCount" in result
      ? { status: "ready" as const, receipt: result } : result.status === "forbidden" ? { status: "forbidden" as const } : unavailable)),
  };
  return { read, results };
}

function publish<T extends NotificationInboxReceipt | NotificationCountReceipt>(
  read: NotificationEntryRead,
  result: { status: "ready"; receipt: T } | { status: "forbidden" | "unavailable" },
) {
  if (result.status !== "ready") return result;
  if (read.readAuthority.deadline <= Date.now() || result.receipt.readAuthority.deadline <= Date.now()) return { status: "forbidden" as const };
  const validUntil = Date.parse(result.receipt.validUntil);
  if (read.timeoutAt <= Date.now() || !Number.isFinite(validUntil) || validUntil <= Date.now()) return { status: "unavailable" as const };
  return result;
}

async function Inbox({ read, result }: { read: NotificationEntryRead; result: NotificationEntryResults["inbox"] }) {
  return <PlanningServerNotificationReceipt id={read.id} outcome={{ area: "inbox", result: publish(read, await result) }} />;
}

async function Count({ read, result }: { read: NotificationEntryRead; result: NotificationEntryResults["count"] }) {
  return <PlanningServerNotificationReceipt id={read.id} outcome={{ area: "count", result: publish(read, await result) }} />;
}

export function PlanningServerNotificationEntry({ read, results }: { read: NotificationEntryRead; results: NotificationEntryResults }) {
  return <>
    <Suspense fallback={null}><Inbox read={read} result={results.inbox} /></Suspense>
    <Suspense fallback={null}><Count read={read} result={results.count} /></Suspense>
  </>;
}
