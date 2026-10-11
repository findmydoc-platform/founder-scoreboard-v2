import { expect, test } from "vitest";
import { verifyPreviewEnvironment } from "../../../scripts/verify-preview-environment.mjs";

const jwt = (ref, role) => `header.${Buffer.from(JSON.stringify({ ref, role })).toString("base64url")}.signature`;
const environment = () => ({
  NEXT_PUBLIC_SUPABASE_URL: "https://previewref.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: jwt("previewref", "anon"),
  SUPABASE_SERVICE_ROLE_KEY: jwt("previewref", "service_role"),
  REQUIRE_SUPABASE_AUTH: "true",
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
