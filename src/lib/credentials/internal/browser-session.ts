"use client";

import type { ServerSessionView } from "../session-types";
export type BrowserSessionSnapshot = ServerSessionView;
export type BrowserSessionRecovery =
  | { kind: "refreshed"; session: BrowserSessionSnapshot }
  | { kind: "superseded" | "temporarily_unavailable" | "unavailable" };
export type BrowserSessionPort = {
  current(): Promise<BrowserSessionSnapshot | null>;
  recover(expected: BrowserSessionSnapshot): Promise<BrowserSessionRecovery>;
  clearIfCurrent(expected: BrowserSessionSnapshot): Promise<void>;
  isCurrent?(expected: BrowserSessionSnapshot): boolean;
};
let known: BrowserSessionSnapshot | null | undefined;
let epoch = 0;
let reading: Promise<BrowserSessionSnapshot | null> | undefined;
const recoveries = new Map<string, Promise<BrowserSessionRecovery>>();
const listeners = new Set<(session: BrowserSessionSnapshot | null) => void>();
let channel: BroadcastChannel | undefined;
let focusInstalled = false;
const same = (a: BrowserSessionSnapshot | null | undefined, b: BrowserSessionSnapshot) => a?.userId === b.userId && a.revision === b.revision;
function publish(session: BrowserSessionSnapshot | null) { known = session; listeners.forEach(listener => listener(session)); }
function changed(kind = "changed") { channel?.postMessage({ kind }); }
function invalidate() { epoch++; reading = undefined; publish(null); }
async function post(path: string, expected: BrowserSessionSnapshot) {
  const response = await fetch(`/api/auth/session/${path}`, { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ expected: { userId: expected.userId, revision: expected.revision } }) });
  return { response, body: await response.json() };
}
async function refresh() {
  if (reading) return reading;
  const started = epoch;
  const operation = (async () => {
    const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    if (response.status >= 500) throw new Error("Sitzung konnte vorübergehend nicht geprüft werden.");
    const body = await response.json();
    if (started === epoch) publish(body.session || null);
    return known || null;
  })();
  reading = operation;
  try { return await operation; } finally { if (reading === operation) reading = undefined; }
}
async function recover(expected: BrowserSessionSnapshot): Promise<BrowserSessionRecovery> {
  if (known && known.userId !== expected.userId) return { kind: "superseded" };
  if (known && !same(known, expected)) return { kind: "refreshed", session: known };
  const key = `${epoch}:${expected.userId}:${expected.revision}`;
  const pending = recoveries.get(key); if (pending) return pending;
  const started = epoch;
  const operation = (async (): Promise<BrowserSessionRecovery> => {
    try {
      const { response, body } = await post("recover", expected);
      if (started !== epoch) return { kind: "superseded" };
      if (response.status >= 500 || body.outcome === "temporarily_unavailable") return { kind: "temporarily_unavailable" };
      if (body.session?.userId === expected.userId && ["refreshed", "superseded"].includes(body.outcome)) {
        publish(body.session); return { kind: "refreshed", session: body.session };
      }
      if (body.outcome === "superseded") { invalidate(); return { kind: "superseded" }; }
      await clearIfCurrent(expected); return { kind: "unavailable" };
    } catch { return { kind: "temporarily_unavailable" }; }
  })();
  recoveries.set(key, operation);
  try { return await operation; } finally { recoveries.delete(key); }
}
async function clearIfCurrent(expected: BrowserSessionSnapshot) {
  if (known && !same(known, expected)) return;
  const started = epoch;
  try {
    const { response, body } = await post("clear", expected);
    if (started !== epoch || !response.ok) return;
    if (body.outcome === "cleared") { invalidate(); changed(); }
    else if (body.session?.userId === expected.userId) publish(body.session);
  } catch { /* A transport failure cannot prove that the current server session was cleared. */ }
}
function ensureChannel() {
  if (typeof window !== "undefined" && !focusInstalled) {
    focusInstalled = true;
    window.addEventListener("focus", () => { epoch++; reading = undefined; refresh().catch(() => undefined); });
  }
  if (typeof window !== "undefined" && !channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("founderops-session");
    channel.onmessage = event => { invalidate(); if (event.data?.kind === "changed") refresh().catch(() => undefined); };
  }
}
function subscribe(listener: (session: BrowserSessionSnapshot | null) => void) {
  listeners.add(listener);
  ensureChannel();
  return () => { listeners.delete(listener); };
}
async function logout() {
  let expected: BrowserSessionSnapshot | null;
  try { expected = await adapter.current(); } catch { invalidate(); return false; }
  invalidate(); changed("changing");
  if (!expected) return true;
  const started = epoch;
  try {
    const { response, body } = await post("logout", expected);
    if (started !== epoch) return false;
    if (response.ok && body.outcome === "cleared") { changed(); return true; }
    return false;
  } catch { return false; }
}
async function performLogin(query: string, local: boolean) {
  if (typeof navigator === "undefined" || !navigator.locks) return "unsupported" as const;
  try {
    return await navigator.locks.request("founderops-session-login", { ifAvailable: true }, async lock => {
      if (!lock) return false;
      invalidate(); changed("changing"); const started = epoch;
      const response = await fetch(local ? "/api/auth/local-login" : `/api/auth/session/login${query}`, {
        method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: "{}",
      });
      const body = await response.json();
      if (started !== epoch || !response.ok) return false;
      changed();
      if (local) window.location.reload();
      else if (typeof body.redirectTo === "string") window.location.assign(body.redirectTo);
      else return false;
      return true;
    });
  } catch { return false; }
}
let loginStarting: Promise<boolean | "unsupported"> | undefined;
function beginLogin(query: string, local: boolean) {
  if (loginStarting) return loginStarting;
  const pending = performLogin(query, local); loginStarting = pending;
  pending.finally(() => { if (loginStarting === pending) loginStarting = undefined; });
  return pending;
}
const adapter = { current: () => known === undefined ? refresh() : Promise.resolve(known), recover, clearIfCurrent,
  isCurrent: (expected: BrowserSessionSnapshot) => same(known, expected), refresh, subscribe, logout, startLogin: (query: string) => beginLogin(query, false), startLocalLogin: async () => (await beginLogin("", true)) === true };
export function createBrowserSessionAdapter() { ensureChannel(); return adapter; }
