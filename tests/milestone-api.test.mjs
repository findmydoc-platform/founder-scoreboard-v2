import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/features/projects/model/milestone-contract.ts");
const policy = await loadTranspiledModule("src/features/projects/model/milestone-policy.ts");
const server = await loadTranspiledModule(
  "src/features/projects/model/milestone-server.ts",
  {
    "server-only": {},
    "@/lib/planning-profile-mappers": {
      mapMilestone: (row) => ({
        id: row.id,
        title: row.title,
        description: row.description || "",
        targetDate: row.target_date || "",
        status: row.status,
        sortOrder: row.sort_order,
        updatedAt: row.updated_at || "",
      }),
    },
    "@/lib/slug": {
      slugify: (value) => String(value).trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""),
    },
    "./milestone-contract": contract,
    "./milestone-policy": policy,
  },
);

test("Milestone create parsing is strict and normalizes allowed fields", () => {
  assert.deepEqual(server.parseMilestoneCreateRequest({
    title: "  Market readiness  ",
    description: "  Prepare the operating model.  ",
    targetDate: "2026-10-31",
    status: "active",
  }), {
    ok: true,
    value: {
      title: "Market readiness",
      description: "Prepare the operating model.",
      targetDate: "2026-10-31",
      status: "active",
    },
  });

  assert.equal(server.parseMilestoneCreateRequest(null).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "ab" }).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "Valid title", targetDate: "2026-02-31" }).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "Valid title", status: "paused" }).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "Valid title", sortOrder: 2 }).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "Valid title", description: "x".repeat(4001) }).ok, false);
});

test("Milestone PATCH requires a real mutable field and compare-and-set version", () => {
  assert.deepEqual(server.parseMilestonePatchRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
    targetDate: null,
    description: "",
  }), {
    ok: true,
    value: {
      expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
      update: { targetDate: null, description: "" },
    },
  });

  assert.equal(server.parseMilestonePatchRequest({ expectedUpdatedAt: "2026-07-14T12:00:00.000Z" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({ title: "Missing version" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({ expectedUpdatedAt: "yesterday", title: "Valid title" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({ expectedUpdatedAt: "2026-02-31T12:00:00.000Z", title: "Valid title" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({ expectedUpdatedAt: "2026-07-14T24:00:00.000Z", title: "Valid title" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
    sortOrder: 4,
  }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
    moveTo: "another",
  }).ok, false);
});

test("Milestone DELETE accepts only the expected version", () => {
  assert.deepEqual(server.parseMilestoneDeleteRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00+00:00",
  }), {
    ok: true,
    value: { expectedUpdatedAt: "2026-07-14T12:00:00+00:00" },
  });
  assert.equal(server.parseMilestoneDeleteRequest({}).ok, false);
  assert.equal(server.parseMilestoneDeleteRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
    cascade: true,
  }).ok, false);
});

test("Milestone inserts own project and ID while leaving sort allocation to the database", () => {
  const insert = server.buildMilestoneInsert({
    title: "Market readiness",
    description: "",
    targetDate: null,
    status: "planned",
  }, "milestone-market-readiness-fixed");

  assert.deepEqual(insert, {
    id: "milestone-market-readiness-fixed",
    project_id: "findmydoc-founder-execution",
    title: "Market readiness",
    description: null,
    target_date: null,
    status: "planned",
  });
  assert.equal(Object.hasOwn(insert, "sort_order"), false);
  assert.match(server.createMilestoneId("Market readiness"), /^milestone-market-readiness-[0-9a-f-]{36}$/);
});

test("Milestone update and delete helpers put project, ID, and updated_at in the mutation predicate", async () => {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push(["from", table]);
      const builder = {
        update(value) { calls.push(["update", value]); return builder; },
        delete() { calls.push(["delete"]); return builder; },
        eq(field, value) { calls.push(["eq", field, value]); return builder; },
        select(value) { calls.push(["select", value]); return builder; },
        maybeSingle() { calls.push(["maybeSingle"]); return Promise.resolve({ data: null, error: null }); },
      };
      return builder;
    },
  };

  await server.updateProjectMilestone(
    supabase,
    "milestone-one",
    "2026-07-14T12:00:00.000Z",
    { title: "Updated title" },
  );
  await server.deleteProjectMilestone(supabase, "milestone-one", "2026-07-14T12:00:00.000Z");

  const equalityPredicates = calls.filter(([operation]) => operation === "eq");
  assert.deepEqual(equalityPredicates.slice(0, 3), [
    ["eq", "project_id", "findmydoc-founder-execution"],
    ["eq", "id", "milestone-one"],
    ["eq", "updated_at", "2026-07-14T12:00:00.000Z"],
  ]);
  assert.deepEqual(equalityPredicates.slice(3), equalityPredicates.slice(0, 3));
});

test("Milestone child counts use both base tables, including trashed rows", async () => {
  const tables = [];
  const supabase = {
    from(table) {
      tables.push(table);
      const result = table === "packages"
        ? { data: null, error: null, count: 2 }
        : { data: null, error: null, count: 1 };
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); },
      };
      return builder;
    },
  };

  assert.deepEqual(await server.loadMilestoneChildCounts(supabase, "milestone-one"), {
    ok: true,
    counts: { initiatives: 2, tasks: 1 },
  });
  assert.deepEqual(tables, ["packages", "tasks"]);
});

test("Known database conflicts share one public non-empty contract without raw messages", () => {
  assert.equal(server.isMilestoneNotEmptyDatabaseError({ code: "23503", message: "raw FK detail" }), true);
  assert.equal(server.isMilestoneNotEmptyDatabaseError({ code: "P0008", message: "raw transaction detail" }), true);
  assert.equal(server.isMilestoneNotEmptyDatabaseError({ code: "23505" }), false);
  assert.deepEqual(server.milestoneNotEmptyError({ initiatives: 1, tasks: 2 }), {
    code: "MILESTONE_NOT_EMPTY",
    error: "Der Meilenstein kann nicht gelöscht werden, weil noch 1 Initiative und 2 Aufgaben zugeordnet sind.",
    children: { initiatives: 1, tasks: 2 },
  });
});

test("Session routes use the narrow role guards and never return raw database errors", async () => {
  const [collectionRoute, itemRoute, serverSource] = await Promise.all([
    readFile("src/app/api/milestones/route.ts", "utf8"),
    readFile("src/app/api/milestones/[id]/route.ts", "utf8"),
    readFile("src/features/projects/model/milestone-server.ts", "utf8"),
  ]);

  assert.match(collectionRoute, /requireApiContext\(request, requireTeamMember\)/);
  assert.match(collectionRoute, /requireJsonApiContext<unknown>\(request, requireOperationalLead, null\)/);
  assert.equal((itemRoute.match(/requireJsonApiContext<unknown>\(request, requireOperationalLead, null\)/g) || []).length, 2);
  assert.doesNotMatch(collectionRoute, /error\.message/);
  assert.doesNotMatch(itemRoute, /error\.message/);
  assert.match(itemRoute, /freshTarget/);
  assert.match(itemRoute, /freshChildren/);
  assert.match(serverSource, /import "server-only"/);
  assert.match(serverSource, /\.eq\("project_id", MILESTONE_PROJECT_ID\)/);
  assert.match(serverSource, /\.eq\("updated_at", expectedUpdatedAt\)/);
});
