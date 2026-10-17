import { afterEach, expect, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function environment() {
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) vi.stubEnv(key, "https://planning.example.test");
  for (const key of ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "SUPABASE_PUBLISHABLE_KEY"]) vi.stubEnv(key, "synthetic-anon");
  for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"]) vi.stubEnv(key, "synthetic-service");
}

test("personal planning requests preserve their missing-token challenge through the public seam", async () => {
  environment();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const result = await authorizeCredentialAction({ credential: { kind: "personal-planning-token", request: { headers: new Headers() } }, action: "planning-items.access", operation: "planningItems.create", mode: "preview" });
  expect(result).toEqual({ ok: false, status: 401, code: "TOKEN_REQUIRED", error: "Planning-API-Token ist erforderlich." });
});
