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
