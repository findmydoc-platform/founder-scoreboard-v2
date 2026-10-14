import { afterEach, expect, test, vi } from "vitest";
import { requestPlanningHeaderData } from "@/features/planning/model/planning-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";

afterEach(() => vi.useRealTimers());

test("a stalled header request times out and the next request can succeed", async () => {
  vi.useFakeTimers();
  const requestJson = vi.fn<BrowserApiClient["requestJson"]>().mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValueOnce({ response: new Response(null), body: { headerData: {} } });
  const client = { requestJson } as unknown as BrowserApiClient;
  const stalled = requestPlanningHeaderData(client, ["notifications"]);
  const rejection = expect(stalled).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(15_000);
  await rejection;
  expect(requestJson.mock.calls[0][1]?.signal?.aborted).toBe(true);
  const retried = await requestPlanningHeaderData(client, ["notifications"]);
  expect(retried.response.ok).toBe(true);
  expect(requestJson.mock.calls[1][1]?.signal?.aborted).toBe(false);
});

test("caller cancellation terminates even a request that ignores its abort signal", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const requestJson = vi.fn<BrowserApiClient["requestJson"]>(() => new Promise(() => {}));
  const pending = requestPlanningHeaderData({ requestJson } as unknown as BrowserApiClient, ["notifications"], { signal: controller.signal });
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejection;
  expect(requestJson.mock.calls[0][1]?.signal?.aborted).toBe(true);
});
