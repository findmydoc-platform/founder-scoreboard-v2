import { NextRequest } from "next/server";
import { expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const target = "opened-deliverable";
const path = "src/app/api/tasks/[id]/review/route.ts";
const params = { params: Promise.resolve({ id: target }) };
const basis = {
  taskId: target, taskUpdatedAt: "2026-11-20T10:00:00Z",
  sourceRevision: "source-1", evaluatedAt: "2026-11-20T11:00:00Z", validUntil: "2026-11-20T12:00:00Z",
  readAuthority: { userId: "reviewer-user", deadline: 1795172400000 },
  readActor: { profileId: "reviewer-profile", platformRole: "founder" },
  evidence: { status: "present", hasException: false, exceptionNote: null, links: [{ taskId: target, title: "Opened", url: "https://example.invalid/evidence", kind: "evidence" }] }, sprintLock: { sprintId: null, locked: false },
  decision: { status: "allowed", token: "authorized-opaque-basis" },
};

test("GET returns the authorized decision basis of only the opened Deliverable", async () => {
  const loadDeliverableReviewBasis = vi.fn(async () => ({ status: "ready", basis }));
  const requirePlanningContext = vi.fn(async () => ({ ok: true, planning: { loadDeliverableReviewBasis } }));
  const { GET } = await importTestModule(path, {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext },
  });
  const request = new NextRequest(`http://localhost/api/tasks/${target}/review`);
  const response = await GET(request, params);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(await response.json()).toEqual({ ok: true, basis });
  expect(requirePlanningContext).toHaveBeenCalledWith(request, "planning.review.basis.read", target);
  expect(loadDeliverableReviewBasis).toHaveBeenCalledWith(request.signal);
});

test.each([
  ["forbidden", 403, "review_basis_denied"],
  ["notFound", 404, "review_target_not_found"],
  ["stale", 409, "stale_review_basis"],
  ["unavailable", 503, "review_basis_unavailable"],
])("GET reports %s without fake evidence or decision authority", async (status, expectedStatus, code) => {
  const { GET } = await importTestModule(path, {
    "server-only": {},
    "@/features/planning/server/planning-api-context": { requirePlanningContext: async () => ({
      ok: true, planning: { loadDeliverableReviewBasis: async () => ({ status }) },
    }) },
  });
  const response = await GET(new NextRequest(`http://localhost/api/tasks/${target}/review`), params);
  expect(response.status).toBe(expectedStatus);
  expect(await response.json()).toEqual({ code, error: expect.any(String) });
});
