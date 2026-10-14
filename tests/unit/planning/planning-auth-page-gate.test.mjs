import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("REQUIRE_SUPABASE_AUTH disables auth only for explicit local development", async () => {
  const supabase = await importTestModule("src/lib/supabase.ts", {
    "@supabase/ssr": { createBrowserClient: () => ({}) },
    "@supabase/supabase-js": { createClient: () => ({}) },
  });
  const keys = [
    "REQUIRE_SUPABASE_AUTH",
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "NODE_ENV",
    "VERCEL",
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    process.env.NODE_ENV = "development";
    process.env.VERCEL = "";
    process.env.REQUIRE_SUPABASE_AUTH = "false";
    assert.equal(supabase.requiresSupabaseAuth(), false);

    process.env.REQUIRE_SUPABASE_AUTH = "true";
    assert.equal(supabase.requiresSupabaseAuth(), true);

    delete process.env.REQUIRE_SUPABASE_AUTH;
    assert.equal(supabase.requiresSupabaseAuth(), true);

    process.env.REQUIRE_SUPABASE_AUTH = "invalid";
    assert.equal(supabase.requiresSupabaseAuth(), true);

    process.env.REQUIRE_SUPABASE_AUTH = "false";
    process.env.NODE_ENV = "production";
    assert.equal(supabase.requiresSupabaseAuth(), true);

    process.env.NODE_ENV = "development";
    process.env.VERCEL = "1";
    assert.equal(supabase.requiresSupabaseAuth(), true);
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
