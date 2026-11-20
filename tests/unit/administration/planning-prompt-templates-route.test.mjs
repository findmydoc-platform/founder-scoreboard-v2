import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const path = "/api/administration/prompt-templates";
const initial = { kind: "general", text: "Schreibe in kurzen Absätzen.", version: 1 };
const revised = { kind: "general", text: "Formuliere eigenständige Kriterien.", version: 2 };

async function fixture() {
  const protocol = administratorProtocol({
    responses: {
      administrator_planning_prompt_templates: [initial],
      publish_planning_prompt_template: revised,
    },
  });
  const route = await importTestModule("src/app/api/administration/prompt-templates/route.ts", { "server-only": {} });
  return {
    ...protocol,
    get: () => route.GET(protocol.request(path, "GET")),
    put: (payload = { kind: "general", text: revised.text, expectedVersion: 1 }) =>
      route.PUT(protocol.request(path, "PUT", payload)),
  };
}

test("active administrators can load the current template and publish a replacement", async () => {
  const current = await fixture();
  expect(await (await current.get()).json()).toEqual({ profileId: "synthetic-profile", templates: [initial] });
  expect(await (await current.put()).json()).toEqual({ template: revised });
  expect(current.calls.at(-1).body).toEqual({ p_kind: "general", p_text: revised.text, p_expected_version: 1 });
});

test("an eligible CEO without active access cannot read or publish", async () => {
  const current = await fixture();
  current.state.role = "ceo";
  current.state.snapshot = { eligible: true, active: false, expiresAt: null };
  expect((await current.get()).status).toBe(403);
  expect((await current.put()).status).toBe(403);
  expect(current.calls).toEqual([]);
});

test("invalid edits and stale versions produce explicit failures", async () => {
  const current = await fixture();
  expect((await current.put({ kind: "general", text: "  ", expectedVersion: 1 })).status).toBe(400);
  expect(current.calls).toEqual([]);
  current.state.responses.publish_planning_prompt_template = () =>
    Response.json({ code: "P0001", message: "Database detail" }, { status: 400 });
  expect((await current.put()).status).toBe(409);
});
