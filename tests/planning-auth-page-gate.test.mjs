import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const protectedPages = [
  "src/app/(workspaces)/workspace-page.tsx",
  "src/app/tasks/[id]/page.tsx",
  "src/app/initiatives/[id]/page.tsx",
  "src/app/reviews/[id]/page.tsx",
];

test("strict auth pages gate only on REQUIRE_SUPABASE_AUTH", async () => {
  const sources = await Promise.all(protectedPages.map((path) => readFile(path, "utf8")));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /requiresSupabaseAuth\(\)/, `${protectedPages[index]} must honor the strict auth flag`);
    assert.doesNotMatch(source, /hasSupabaseEnv/, `${protectedPages[index]} must not bypass strict auth when Supabase env is incomplete`);
    assert.doesNotMatch(source, /hasSupabaseEnv\(\)\s*&&\s*requiresSupabaseAuth\(\)/);
  }
});

test("REQUIRE_SUPABASE_AUTH remains fail-closed across Supabase env combinations", async () => {
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
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  try {
    for (const configured of [false, true]) {
      for (const required of [false, true]) {
        process.env.REQUIRE_SUPABASE_AUTH = required ? "true" : "false";
        process.env.SUPABASE_URL = configured ? "https://example.supabase.co" : "";
        process.env.SUPABASE_ANON_KEY = configured ? "anon-key" : "";
        assert.equal(supabase.requiresSupabaseAuth(), required);
      }
    }
  } finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});
