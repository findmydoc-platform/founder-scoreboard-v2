import assert from "node:assert/strict";
import test from "node:test";
import { listSupabaseMigrations } from "../scripts/lib/supabase-migrations.mjs";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const policy = await loadTranspiledModule(
  "src/features/profile/model/profile-color-policy.ts",
);

test("database profile-color palette stays in exact application order", async () => {
  const migrations = await listSupabaseMigrations();
  const migration = migrations.find((item) => item.name === "enforce_profile_color_palette");
  assert.ok(migration, "profile-color migration is missing");

  const paletteFunction = migration.sql.match(
    /create or replace function public\.profile_color_palette\(\)[\s\S]*?select array\[([\s\S]*?)\]::text\[\][\s\S]*?\$\$;/i,
  );
  assert.ok(paletteFunction, "database palette function is missing");
  const databaseColors = [...paletteFunction[1].matchAll(/'(#(?:[0-9a-f]{6}))'/gi)]
    .map((match) => match[1].toLowerCase());
  assert.deepEqual(
    databaseColors,
    policy.profileColorOptions.map((option) => option.value),
  );
});

test("profile-color migration centralizes collision checks for both write transactions", async () => {
  const migrations = await listSupabaseMigrations();
  const migration = migrations.find((item) => item.name === "enforce_profile_color_palette");
  assert.ok(migration, "profile-color migration is missing");
  const sql = migration.sql.toLowerCase();

  assert.match(sql, /update public\.profiles[\s\S]*profile_color/);
  assert.match(sql, /profiles_profile_color_palette/);
  assert.match(sql, /profile_color = any \(public\.profile_color_palette\(\)\)/);
  assert.match(sql, /create or replace function public\.apply_profile_color_change/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /profile_color_duplicate_mode/);
  assert.match(sql, /errcode = 'p0001'/);
  assert.match(sql, /create or replace function public\.update_profile_settings_transaction[\s\S]*apply_profile_color_change/);
  assert.match(sql, /create or replace function public\.update_profile_admin_transaction[\s\S]*apply_profile_color_change/);
  assert.match(sql, /create trigger assign_profile_color_before_insert/);
  assert.match(sql, /planning filters must use canonical fields/);
  assert.doesNotMatch(sql, /p_ui_preferences -> 'expanded_package_ids'/);
  assert.match(sql, /revoke all on function public\.apply_profile_color_change[\s\S]*from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.apply_profile_color_change[\s\S]*to service_role/);
});
