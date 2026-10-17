import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("invalid GitHub login is rejected before a technical identity transaction", async () => {
  const current = administratorProtocol();
  const route = await importTestModule("src/app/api/administration/profiles/[id]/technical/route.ts", { "server-only": {} });
  const response = await route.PATCH(current.request("/", "PATCH", { githubLogin: "bad_login" }), { params: Promise.resolve({ id: "synthetic-target" }) });
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "GitHub-Login ist ungültig." });
  expect(current.calls).toEqual([]);
});
