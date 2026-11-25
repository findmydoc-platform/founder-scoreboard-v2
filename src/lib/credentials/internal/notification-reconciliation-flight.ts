import "server-only";
import { createHash } from "node:crypto";
import type { reconcileNotificationEvents } from "../../notification-resolution";

type Result = Awaited<ReturnType<typeof reconcileNotificationEvents>>;
type Flight = { controller: AbortController; waiters: number; promise: Promise<Result> };
const flights = new Map<string, Flight>();

export function notificationReconciliationKey(token: string, serviceKey: string, serviceUrl: string, profileId: string, role: string, deadline: number, revision: string) {
  return createHash("sha256").update(JSON.stringify([token, serviceKey, serviceUrl, profileId, role, deadline, revision])).digest("hex");
}

export async function shareNotificationReconciliation(
  key: string,
  signal: AbortSignal,
  run: (signal: AbortSignal) => Promise<Result>,
): Promise<Result> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  let flight = flights.get(key);
  if (!flight) {
    const controller = new AbortController();
    const entry: Flight = { controller, waiters: 0, promise: Promise.resolve(undefined as never) };
    entry.promise = new Promise<void>(resolve => setTimeout(resolve, 0)).then(() => {
      if (flights.get(key) === entry) flights.delete(key);
      return run(controller.signal);
    }).finally(() => {
      if (flights.get(key) === entry) flights.delete(key);
    });
    flights.set(key, entry);
    flight = entry;
  }
  const current = flight;
  current.waiters++;
  try {
    return await new Promise<Result>((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      current.promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  } finally {
    current.waiters--;
    if (!current.waiters) {
      if (flights.get(key) === current) flights.delete(key);
      current.controller.abort();
    }
  }
}
