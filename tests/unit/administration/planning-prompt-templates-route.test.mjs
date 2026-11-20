import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const path = "/api/administration/prompt-templates";
const initial = { kind: "general", text: "Schreibe in kurzen Absätzen.", version: 1 };
const revised = { kind: "general", text: "Formuliere eigenständige Kriterien.", version: 2 };

const audienceDirectory = { audience: { mode: "selected", profileIds: [] }, profiles: [] };

async function fixture() {
  const protocol = administratorProtocol({
    responses: {
      administrator_planning_prompt_templates: [initial],
      administrator_planning_prompt_template_audience: audienceDirectory,
      publish_planning_prompt_template: revised,
    },
  });
  const route = await importTestModule("src/app/api/administration/prompt-templates/route.ts", { "server-only": {} });
  return {
    ...protocol,
    get: () => route.GET(protocol.request(path, "GET")),
    patch: payload => route.PATCH(protocol.request(path, "PATCH", payload)),
    put: (payload = { kind: "general", text: revised.text, expectedVersion: 1 }) =>
      route.PUT(protocol.request(path, "PUT", payload)),
  };
}

test("active administrators can load the current template and publish a replacement", async () => {
  const current = await fixture();
  expect(await (await current.get()).json()).toEqual({ profileId: "synthetic-profile", templates: [initial], ...audienceDirectory });
  expect(await (await current.put()).json()).toEqual({ template: revised });
  expect(current.calls.at(-1).body).toEqual({ p_kind: "general", p_text: revised.text, p_expected_version: 1 });
});

test.each(["initiative", "deliverable", "sub_issue"])("active administrators can publish the %s template", async (kind) => {
  const current = await fixture();
  const template = { kind, text: "Beschreibe das erwartete Ergebnis.", version: 3 };
  current.state.responses.publish_planning_prompt_template = template;

  expect(await (await current.put({ kind, text: template.text, expectedVersion: 2 })).json()).toEqual({ template });
  expect(current.calls.at(-1).body).toEqual({ p_kind: kind, p_text: template.text, p_expected_version: 2 });
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
  expect((await current.put({ kind: "epic", text: revised.text, expectedVersion: 1 })).status).toBe(400);
  expect(current.calls).toEqual([]);
  current.state.responses.publish_planning_prompt_template = () =>
    Response.json({ code: "P0001", message: "Database detail" }, { status: 400 });
  expect((await current.put()).status).toBe(409);
});

test("active administrators save the mode without replacing the selected profiles", async () => {
  const current = await fixture();
  const audience = { mode: "all", profileIds: ["selected-profile"] };
  current.state.responses.save_planning_prompt_template_audience = audience;

  const response = await current.patch({ mode: "all" });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ audience });
  expect(current.calls).toEqual([{
    name: "save_planning_prompt_template_audience",
    body: { p_mode: "all", p_profile_ids: null },
  }]);
});

test.each(["inactive CEO", "unmapped", "expired database access"])("audience save denies %s", async state => {
  const current = await fixture();
  if (state === "inactive CEO") {
    current.state.role = "ceo";
    current.state.snapshot = { eligible: true, active: false, expiresAt: null };
  } else if (state === "unmapped") {
    current.state.profile = false;
  } else {
    current.state.responses.save_planning_prompt_template_audience = () =>
      Response.json({ code: "42501", message: "Database detail" }, { status: 403 });
  }
  expect((await current.patch({ mode: "all" })).status).toBe(403);
  expect(current.calls).toHaveLength(state === "expired database access" ? 1 : 0);
});

test.each([{}, { mode: "everyone" }, { mode: "all", profileIds: [] }, { profileIds: [null] }, { profileIds: [""] }])(
  "audience save rejects the invalid payload %j",
  async payload => {
    const current = await fixture();
    expect((await current.patch(payload)).status).toBe(400);
    expect(current.calls).toEqual([]);
  },
);
