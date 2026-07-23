import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const protectedPages = [
  "src/app/(workspaces)/workspace-page.tsx",
  "src/app/tasks/[id]/page.tsx",
  "src/app/initiatives/[id]/page.tsx",
];

test("legacy review detail links redirect into the protected task detail page", async () => {
  const source = await readFile("src/app/reviews/[id]/page.tsx", "utf8");
  assert.match(source, /permanentRedirect\(`\/tasks\/\$\{encodeURIComponent\(id\)\}`\)/);
  assert.doesNotMatch(source, /requiresSupabaseAuth|ReviewDetailPage/);
});

test("strict auth pages gate only on REQUIRE_SUPABASE_AUTH", async () => {
  const sources = await Promise.all(protectedPages.map((path) => readFile(path, "utf8")));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /requiresSupabaseAuth\(\)/, `${protectedPages[index]} must honor the strict auth flag`);
    assert.doesNotMatch(source, /hasSupabaseEnv/, `${protectedPages[index]} must not bypass strict auth when Supabase env is incomplete`);
    assert.doesNotMatch(source, /hasSupabaseEnv\(\)\s*&&\s*requiresSupabaseAuth\(\)/);
  }
});

test("REQUIRE_SUPABASE_AUTH disables auth only for explicit local development", async () => {
  const supabase = await loadTranspiledModule("src/lib/supabase.ts", {
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
