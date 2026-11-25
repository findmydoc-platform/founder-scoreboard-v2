import { afterEach, expect, test, vi } from "vitest";
import { requestPlanningHeaderData, requestPlanningWorkspaceData, requestSupportingWorkspaceData, requestSprintWorkspaceData } from "@/features/planning/model/planning-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";

afterEach(() => vi.useRealTimers());

test("independent notification headers are explicitly requested without changing legacy calls", async () => {
  const requestJson = vi.fn<BrowserApiClient["requestJson"]>().mockResolvedValue({ response: new Response(null), body: {} });
  const client = { requestJson } as unknown as BrowserApiClient;
  await requestSupportingWorkspaceData(client, "profile");
  await requestSupportingWorkspaceData(client, "profile", { independentHeader: true });
  await requestSupportingWorkspaceData(client, "events", { independentHeader: true });
  await requestSprintWorkspaceData(client);
  await requestSprintWorkspaceData(client, { independentHeader: true });
  await requestPlanningWorkspaceData(client, "projects", undefined, { independentHeader: true });
  expect(requestJson.mock.calls.map(call => call[0])).toEqual(["/api/profile-data", "/api/profile-data?header=independent", "/api/events-data?header=independent", "/api/sprint-data", "/api/sprint-data?header=independent", "/api/strategic-planning-data?header=independent"]);
});

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
