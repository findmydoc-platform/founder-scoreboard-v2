import { expect, test } from "vitest";
import { validateLocalSupabaseTarget } from "../../helpers/local-supabase-target.mjs";

const config = (api = 54321, db = 54322, project = "standard-test") => `project_id = "${project}"\n[api]\nport = ${api}\n[db]\nport = ${db}\n`;
const status = (api = 54321, db = 54322) => ({ API_URL: `http://127.0.0.1:${api}`, DB_URL: `postgresql://postgres:synthetic@127.0.0.1:${db}/postgres` });

test.each([[54321, 54322, "standard-test"], [56321, 56322, "dedicated-test"]])("accepts the current configured local project on API%s/database%s without optional binding", (api, db, project) => {
  const actual = status(api, db);
  expect(validateLocalSupabaseTarget(actual, config(api, db, project))).toBe(actual);
});
test("accepts an explicitly matching database binding", () => {
  const actual = status();
  expect(validateLocalSupabaseTarget(actual, config(), actual.DB_URL)).toBe(actual);
});
test.each([
  ["external API", { ...status(), API_URL: "https://external.example.test:54321" }, config(), undefined],
  ["external database", { ...status(), DB_URL: "postgresql://postgres:synthetic@external.example.test:54322/postgres" }, config(), undefined],
  ["wrong API port", status(56321), config(), undefined],
  ["wrong database port", status(54321, 56322), config(), undefined],
  ["missing project", status(), "[api]\nport=54321\n[db]\nport=54322", undefined],
  ["missing configured port", status(), 'project_id="test"\n[api]\nport=54321\n[db]', undefined],
  ["missing actual database", { API_URL: status().API_URL }, config(), undefined],
  ["wrong protocol", { ...status(), API_URL: "file://127.0.0.1:54321" }, config(), undefined],
  ["mismatched explicit binding", status(), config(), status(54321, 56322).DB_URL],
  ["empty explicit binding", status(), config(), ""],
])("rejects %s without exposing credentials", (_name, actual, configured, binding) => {
  expect(() => validateLocalSupabaseTarget(actual, configured, binding)).toThrow(/configured local Supabase target/);
  try { validateLocalSupabaseTarget(actual, configured, binding); } catch (error) { expect(error.message).not.toContain("synthetic"); }
});
