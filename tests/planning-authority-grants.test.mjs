import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const authoritySqlFiles = [
  "supabase/0061_approval_reasons_and_return.sql",
  "supabase/fix-api-grants.sql",
  "supabase/schema.sql",
];

test("planning authority tables are read-only for authenticated clients", async () => {
  const files = await Promise.all(authoritySqlFiles.map(async (path) => ({
    path,
    sql: await readFile(path, "utf8"),
  })));

  for (const { path, sql } of files) {
    assert.match(
      sql,
      /revoke insert, update, delete on table public\.packages, public\.tasks\s+from public, anon, authenticated;/i,
      `${path} must revoke direct planning writes from browser roles`,
    );
    assert.match(
      sql,
      /grant select on(?: table)?[^;]*packages[^;]*tasks[^;]*to authenticated, service_role;/i,
      `${path} must preserve authenticated planning reads`,
    );
    assert.match(
      sql,
      /grant insert, update, delete on table public\.packages, public\.tasks\s+to service_role;/i,
      `${path} must preserve server-side planning writes`,
    );
    assert.match(sql, /drop policy if exists "packages_write_members" on (?:public\.)?packages;/i);
    assert.match(sql, /drop policy if exists "tasks_write_members" on (?:public\.)?tasks;/i);
    assert.doesNotMatch(sql, /create policy "(?:packages|tasks)_write_members"/i);
  }
});

test("profile role lookup is not executable by public or anonymous clients", async () => {
  const files = await Promise.all(authoritySqlFiles.map(async (path) => ({
    path,
    sql: await readFile(path, "utf8"),
  })));

  for (const { path, sql } of files) {
    assert.match(
      sql,
      /revoke all on function public\.current_profile_role\(\) from public, anon;/i,
      `${path} must revoke the default function privilege`,
    );
    assert.match(
      sql,
      /grant execute on function public\.current_profile_role\(\) to authenticated, service_role;/i,
      `${path} must preserve the RLS helper for authenticated users and server operations`,
    );
  }
});
