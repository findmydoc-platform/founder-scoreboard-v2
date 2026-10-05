import { afterEach, expect, test, vi } from "vitest";
import { authOrigin, safeRelativeNext } from "../../../src/lib/auth-redirect.ts";

afterEach(() => vi.unstubAllEnvs());

function environment(env, appUrl = "") {
  vi.stubEnv("VERCEL_ENV", env);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APP_URL", appUrl);
  vi.stubEnv("VERCEL_URL", "founder-ops-preview.example.vercel.app");
}

test.each(["production", "preview"])("uses the explicitly configured HTTPS origin in %s", env => {
  environment(env, "https://planning.example.com");
  expect(authOrigin()).toBe("https://planning.example.com");
});

test("uses the platform deployment URL when Preview has no fixed APP_URL", () => {
  environment("preview");
  expect(authOrigin()).toBe("https://founder-ops-preview.example.vercel.app");
});

test("Production requires APP_URL instead of falling back to a deployment URL", () => {
  environment("production");
  expect(() => authOrigin()).toThrow();
});

test.each([
  "http://planning.example.com", "https://user:password@planning.example.com",
  "https://planning.example.com/auth", "https://planning.example.com?next=/auth",
  "https://planning.example.com#auth", "javascript:alert(1)",
])("rejects unsafe or non-origin APP_URL %s", url => {
  environment("preview", url);
  expect(() => authOrigin()).toThrow();
});

test("allows HTTP localhost only during local development", () => {
  environment("development");
  vi.stubEnv("NODE_ENV", "development");
  expect(authOrigin()).toBe("http://localhost:3000");
  vi.stubEnv("APP_URL", "http://localhost:3002");
  expect(authOrigin()).toBe("http://localhost:3002");
  vi.stubEnv("NODE_ENV", "production");
  expect(() => authOrigin()).toThrow();
});

test.each(["//evil.example", "https://evil.example", "/\\evil.example"])("rejects external post-login redirects %s", url => {
  expect(safeRelativeNext(url)).toBe("/");
});
