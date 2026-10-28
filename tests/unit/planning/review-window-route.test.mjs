import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
const { PATCH } = await importTestModule("src/app/api/sprints/review-window/route.ts", { "server-only": {} });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const payload = { expectedReviewObjectionWindowHours: 48, reviewObjectionWindowHours: 96 };
test("only the Review-window expected-value transaction conflict receives its conflict code", async () => {
  const protocol = administratorProtocol({ role: "ceo", responses: { update_founderops_review_window_transaction: body => { expect(body.p_expected_hours).toBe(48); return Response.json({ code: "P0001", message: "Changed" }, { status: 400 }); } } });
  const response = await PATCH(protocol.request("/api/sprints/review-window", "PATCH", payload));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "review_window_conflict" });
});


test.each(["founder", "deputy", "administrator"])("Review-window route remains CEO-only for role %s", async role => {
  const protocol = administratorProtocol({ role });
  expect((await PATCH(protocol.request("/api/sprints/review-window", "PATCH", payload))).status).toBe(403);
  expect(protocol.calls.some(call => call.name === "update_founderops_review_window_transaction")).toBe(false);
});
test.each([{ ...payload, reviewObjectionWindowHours: 0 }, { ...payload, reviewObjectionWindowHours: 337 }, { ...payload, reviewObjectionWindowHours: 2.5 }, { reviewObjectionWindowHours: 72 }])("invalid Review-window input fails before mutation: %j", async invalid => {
  const protocol = administratorProtocol({ role: "ceo" });
  expect((await PATCH(protocol.request("/api/sprints/review-window", "PATCH", invalid))).status).toBe(400);
  expect(protocol.calls.some(call => call.name === "update_founderops_review_window_transaction")).toBe(false);
});
test("Review-window route returns only its actually confirmed deadline fields", async () => {
  const protocol = administratorProtocol({ role: "ceo", responses: { update_founderops_review_window_transaction: { project: { id: "project", reviewObjectionWindowHours: 96 }, sprints: [{ id: "open", reviewDueAt: "confirmed" }, { id: "without-end", reviewDueAt: null }] } } });
  const response = await PATCH(protocol.request("/api/sprints/review-window", "PATCH", payload));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ project: { reviewObjectionWindowHours: 96 }, sprints: [{ id: "open", reviewDueAt: "confirmed" }] });
});
