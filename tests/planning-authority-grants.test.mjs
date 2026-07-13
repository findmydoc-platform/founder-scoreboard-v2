import assert from "node:assert/strict";
import test from "node:test";
import { readSupabaseMigrationCorpus } from "../scripts/lib/supabase-migrations.mjs";

const authoritySql = await readSupabaseMigrationCorpus();

test("planning authority tables are read-only for authenticated clients", async () => {
  for (const table of ["packages", "tasks"]) {
    assert.match(
      authoritySql,
      new RegExp(`GRANT SELECT,[^;]* ON TABLE "public"\\."${table}" TO "authenticated";`, "i"),
      `${table} must preserve authenticated planning reads`,
    );
    assert.doesNotMatch(
      authoritySql,
      new RegExp(`GRANT [^;]*(?:INSERT|UPDATE|DELETE)[^;]* ON TABLE "public"\\."${table}" TO "authenticated";`, "i"),
      `${table} must reject direct authenticated planning writes`,
    );
    assert.match(
      authoritySql,
      new RegExp(`GRANT ALL ON TABLE "public"\\."${table}" TO "service_role";`, "i"),
      `${table} must preserve server-side planning writes`,
    );
  }
  assert.doesNotMatch(authoritySql, /CREATE POLICY "(?:packages|tasks)_write_members"/i);
});

test("profile role lookup is not executable by public or anonymous clients", async () => {
  assert.match(authoritySql, /REVOKE ALL ON FUNCTION "public"\."current_profile_role"\(\) FROM PUBLIC;/i);
  assert.doesNotMatch(authoritySql, /GRANT ALL ON FUNCTION "public"\."current_profile_role"\(\) TO "anon";/i);
  assert.match(authoritySql, /GRANT ALL ON FUNCTION "public"\."current_profile_role"\(\) TO "authenticated";/i);
  assert.match(authoritySql, /GRANT ALL ON FUNCTION "public"\."current_profile_role"\(\) TO "service_role";/i);
});
