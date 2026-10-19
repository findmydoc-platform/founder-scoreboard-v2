import { expect, test } from "vitest";
import { verifyPreviewEnvironment } from "../../../scripts/verify-preview-environment.mjs";

const jwt = (ref, role) => `header.${Buffer.from(JSON.stringify({ ref, role })).toString("base64url")}.signature`;
const environment = () => ({
  NEXT_PUBLIC_SUPABASE_URL: "https://previewref.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("previewref", "anon"),
  SUPABASE_SERVICE_ROLE_KEY: jwt("previewref", "service_role"),
  REQUIRE_SUPABASE_AUTH: "true",
  NOTION_DECISION_LOG_ENABLED: "false",
  GOOGLE_CHAT_DELIVERY_ENABLED: "false",
});

test("accepts an isolated database with matching keys and required authentication", () => {
  expect(verifyPreviewEnvironment(environment(), "productionref")).toBe("previewref");
});

test("skips a completely unconfigured backend only when explicitly allowed", () => {
  const env = { REQUIRE_SUPABASE_AUTH: "true" };
  expect(() => verifyPreviewEnvironment(env, "productionref")).toThrow();
  expect(verifyPreviewEnvironment(env, "productionref", { allowUnconfigured: true })).toBeNull();
});

test.each([
  "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY",
])("does not skip a partially configured backend with %s", key => {
  expect(() => verifyPreviewEnvironment({ REQUIRE_SUPABASE_AUTH: "true", [key]: environment()[key] || "configured" }, "productionref", { allowUnconfigured: true })).toThrow();
});

test("optional Preview still rejects Production, missing target guard, and disabled authentication", () => {
  expect(() => verifyPreviewEnvironment(environment(), "previewref", { allowUnconfigured: true })).toThrow(/production database/);
  expect(() => verifyPreviewEnvironment({ REQUIRE_SUPABASE_AUTH: "true" }, "", { allowUnconfigured: true })).toThrow(/reference is required/);
  expect(() => verifyPreviewEnvironment({ REQUIRE_SUPABASE_AUTH: "false" }, "productionref", { allowUnconfigured: true })).toThrow(/require authentication/);
});

test("rejects the production database and missing production reference", () => {
  expect(() => verifyPreviewEnvironment(environment(), "previewref")).toThrow(/production database/);
  expect(() => verifyPreviewEnvironment(environment(), "")).toThrow(/reference is required/);
});

test.each([
  ["NEXT_PUBLIC_SUPABASE_URL", "http://previewref.supabase.co"],
  ["NEXT_PUBLIC_SUPABASE_URL", "https://previewref.supabase.co/rest/v1"],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", jwt("productionref", "anon")],
  ["NEXT_PUBLIC_SUPABASE_ANON_KEY", jwt("previewref", "service_role")],
  ["SUPABASE_SERVICE_ROLE_KEY", jwt("previewref", "anon")],
  ["SUPABASE_SERVICE_ROLE_KEY", ""],
  ["REQUIRE_SUPABASE_AUTH", "false"],
])("rejects unsafe Preview setting %s", (key, value) => {
  expect(() => verifyPreviewEnvironment({ ...environment(), [key]: value }, "productionref")).toThrow();
});

const smokeRun = overrides => ({
  enabled: true,
  eventName: "workflow_dispatch",
  expectedSha: "a".repeat(40),
  actualSha: "a".repeat(40),
  ...overrides,
});

test("accepts the production backend only for an explicitly approved manual commit", () => {
  expect(verifyPreviewEnvironment(environment(), "previewref", { sharedBackendSmoke: smokeRun() })).toBe("previewref");
});


test.each([
  { enabled: false },
  { eventName: "pull_request" },
  { eventName: "push" },
  { expectedSha: "b".repeat(40) },
  { expectedSha: "" },
  { expectedSha: "main", actualSha: "main" },
  { actualSha: undefined },
])("rejects an unapproved shared-backend run %j", overrides => {
  expect(() => verifyPreviewEnvironment(environment(), "previewref", { sharedBackendSmoke: smokeRun(overrides) })).toThrow();
});

test("shared-backend approval cannot bypass required authentication or matching keys", () => {
  expect(() => verifyPreviewEnvironment({ ...environment(), REQUIRE_SUPABASE_AUTH: "false" }, "previewref", { sharedBackendSmoke: smokeRun() })).toThrow(/authentication/);
  expect(() => verifyPreviewEnvironment({ ...environment(), SUPABASE_SERVICE_ROLE_KEY: jwt("otherref", "service_role") }, "previewref", { sharedBackendSmoke: smokeRun() })).toThrow(/project and role/);
});

test("an invalid smoke authorization fails even when the backend is unconfigured", () => {
  expect(() => verifyPreviewEnvironment({ REQUIRE_SUPABASE_AUTH: "true" }, "productionref", { allowUnconfigured: true, sharedBackendSmoke: smokeRun({ eventName: "pull_request" }) })).toThrow(/manual run/);
});


test.each(["NOTION_DECISION_LOG_ENABLED", "GOOGLE_CHAT_DELIVERY_ENABLED"])("shared-backend smoke requires %s to remain disabled", key => {
  expect(() => verifyPreviewEnvironment({ ...environment(), [key]: "true" }, "previewref", { sharedBackendSmoke: smokeRun() })).toThrow(/integrations/);
});
