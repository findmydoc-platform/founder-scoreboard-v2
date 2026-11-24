import { expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const { shareNotificationReconciliation: share, notificationReconciliationKey: key } = await importTestModule("src/lib/credentials/internal/notification-reconciliation-flight.ts", { "server-only": {} });
const ready = { ok: true, checked: 0, resolved: 0, error: "", observedAt: "2026-01-01T00:00:00.000Z", validUntil: "2026-01-01T01:00:00.000Z" };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test("a departed caller cannot abort remaining demand and completed work is never cached", async () => {
  const gate = deferred(), first = new AbortController(), second = new AbortController();
  const run = vi.fn(async signal => { await gate.promise; expect(signal.aborted).toBe(false); return ready; });
  const a = share("same-session-source", first.signal, run), b = share("same-session-source", second.signal, run);
  first.abort();
  await expect(a).rejects.toMatchObject({ name: "AbortError" });
  gate.resolve();
  await expect(b).resolves.toEqual(ready);
  expect(run).toHaveBeenCalledTimes(1);
  await expect(share("same-session-source", new AbortController().signal, run)).resolves.toEqual(ready);
  expect(run).toHaveBeenCalledTimes(2);
});

test("all departures abort pending work and new demand never joins it", async () => {
  const started = deferred(), stopped = deferred(), first = new AbortController(), second = new AbortController();
  const run = vi.fn(signal => new Promise(resolve => { started.resolve(); signal.addEventListener("abort", () => { stopped.resolve(); resolve({ ...ready, ok: false }); }, { once: true }); }));
  const a = share("abort-all", first.signal, run), b = share("abort-all", second.signal, run);
  await started.promise; first.abort(); second.abort();
  await expect(a).rejects.toMatchObject({ name: "AbortError" });
  await expect(b).rejects.toMatchObject({ name: "AbortError" });
  await stopped.promise;
  await expect(share("abort-all", new AbortController().signal, async () => ready)).resolves.toEqual(ready);
  expect(run).toHaveBeenCalledTimes(1);
});

test("different identities or revisions never share in-flight work", async () => {
  const gate = deferred(), run = vi.fn(async () => { await gate.promise; return ready; });
  const pending = ["actor-a-session-a-source-1", "actor-b-session-a-source-1", "actor-a-session-b-source-1", "actor-a-session-a-source-2"].map(key => share(key, new AbortController().signal, run));
  await new Promise(resolve => setTimeout(resolve, 10)); expect(run).toHaveBeenCalledTimes(4); gate.resolve();
  await expect(Promise.all(pending)).resolves.toEqual([ready, ready, ready, ready]);
});

test("a failed flight is removed and a retry performs new work", async () => {
  const fail = vi.fn(async () => { throw new Error("basis unavailable"); });
  await expect(share("retry", new AbortController().signal, fail)).rejects.toThrow("basis unavailable");
  const success = vi.fn(async () => ready);
  await expect(share("retry", new AbortController().signal, success)).resolves.toEqual(ready);
  expect(success).toHaveBeenCalledTimes(1);
});


test("later demand does not join a reconciliation that already started", async () => {
  const gate = deferred(), started = deferred();
  const run = vi.fn(async () => { started.resolve(); await gate.promise; return ready; });
  const first = share("started", new AbortController().signal, run);
  await started.promise;
  const second = share("started", new AbortController().signal, run);
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(run).toHaveBeenCalledTimes(2);
  gate.resolve();
  await expect(Promise.all([first, second])).resolves.toEqual([ready, ready]);
});


test("the sharing key binds session, service, actor, role, original deadline and source", () => {
  const basis = ["session-secret", "service-secret", "https://example.test", "actor", "viewer", 12345, "source"];
  const reference = key(...basis);
  expect(reference).not.toContain("secret");
  for (let index = 0; index < basis.length; index++) {
    const changed = [...basis]; changed[index] = index === 5 ? 12346 : `${changed[index]}-different`;
    expect(key(...changed)).not.toBe(reference);
  }
});
