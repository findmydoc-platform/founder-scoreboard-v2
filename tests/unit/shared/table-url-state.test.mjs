import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

async function loadUrlState() {
  return importTestModule("src/shared/hooks/use-table-url-state.ts", {
    "next/navigation": { usePathname: () => "/planning", useSearchParams: () => new URLSearchParams() },
  });
}

test("table URL state parses typed values and rejects invalid enum and date values", async () => {
  const { dateUrlField, enumUrlField, multiEnumUrlField, readTableUrlState, stringUrlField } = await loadUrlState();
  const schema = {
    query: stringUrlField(),
    status: enumUrlField("all", ["all", "open", "done"]),
    tags: multiEnumUrlField([], ["risk", "owner", "review"]),
    from: dateUrlField(),
  };
  const state = readTableUrlState("tasks", schema, new URLSearchParams(
    "tasks.query=alpha&tasks.status=invalid&tasks.tags=risk&tasks.tags=unknown&tasks.tags=owner&tasks.from=2026-02-31",
  ));

  assert.deepEqual(state, { query: "alpha", status: "all", tags: ["risk", "owner"], from: "" });
});

test("table URL state omits defaults, repeats multi-values, and preserves unrelated parameters", async () => {
  const { enumUrlField, multiEnumUrlField, stringUrlField, writeTableUrlState } = await loadUrlState();
  const schema = {
    query: stringUrlField(),
    status: enumUrlField("all", ["all", "open"]),
    tags: multiEnumUrlField([], ["risk", "owner"]),
  };
  const params = writeTableUrlState("tasks", schema, {
    query: "",
    status: "open",
    tags: ["risk", "owner"],
  }, new URLSearchParams("reviewTask=42&tasks.query=old&other.keep=yes"));

  assert.equal(params.get("tasks.query"), null);
  assert.equal(params.get("tasks.status"), "open");
  assert.deepEqual(params.getAll("tasks.tags"), ["risk", "owner"]);
  assert.equal(params.get("reviewTask"), "42");
  assert.equal(params.get("other.keep"), "yes");
});

