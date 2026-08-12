import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

function recordingSupabase(data = {}, failedTable = "") {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const query = {
        select() { return query; },
        eq() { return query; },
        single() { return query; },
        order() { return query; },
        limit() { return query; },
        then(resolve, reject) {
          return Promise.resolve(table === failedTable
            ? { data: null, error: { message: "failure" } }
            : { data: data[table] ?? [], error: null }).then(resolve, reject);
        },
      };
      return query;
    },
  };
}

const sharedStubs = {
  "server-only": {},
  "@/features/planning-items/server/planning-workspace-read-source": {
    planningProfileSelect: "id",
  },
  "@/lib/planning-row-mappers": {
    mapFounderEvent: (row) => ({ id: row.id, updatedAt: row.updated_at }),
    mapFmdTool: (row) => ({ id: row.id, sortOrder: row.sort_order }),
  },
  "@/lib/planning-profile-mappers": { mapProfile: (row) => row },
};

const { createSupabaseEventsReadModel } = await loadTranspiledModule(
  "src/features/events/server/events-read-model-supabase.ts",
  sharedStubs,
);
const { createSupabaseToolsReadModel } = await loadTranspiledModule(
  "src/features/tools/server/tools-read-model-supabase.ts",
  sharedStubs,
);

test("Events and Tools expose focused fail-closed load interfaces", async () => {
  const denied = recordingSupabase();
  assert.deepEqual(await createSupabaseEventsReadModel(denied).load({ authorized: false, actorProfileId: null }), { status: "forbidden" });
  assert.equal(denied.calls.length, 0);

  const eventsDb = recordingSupabase({ profiles: [{ id: "person" }], founder_events: [{ id: 1, updated_at: "2026-08-12" }] });
  const events = await createSupabaseEventsReadModel(eventsDb).load({ authorized: true, actorProfileId: "person" });
  assert.equal(events.status, "ready");
  assert.deepEqual(eventsDb.calls, ["profiles", "founder_events"]);
  assert.deepEqual(Object.keys(events.model).sort(), ["events", "people", "revision"]);

  const toolsDb = recordingSupabase({ profiles: [{ id: "person" }], fmd_tools: [{ id: "tool", sort_order: 1 }] });
  const tools = await createSupabaseToolsReadModel(toolsDb).load({ authorized: true, actorProfileId: "person" });
  assert.equal(tools.status, "ready");
  assert.deepEqual(toolsDb.calls, ["profiles", "fmd_tools"]);
  assert.deepEqual(Object.keys(tools.model).sort(), ["people", "revision", "tools"]);
});

test("supporting workspaces own one loader and no longer appear in global scopes", async () => {
  const [page, apiClient, adapter] = await Promise.all([
    readFile("src/app/(workspaces)/workspace-page.tsx", "utf8"),
    readFile("src/features/planning/model/planning-api-client.ts", "utf8"),
    readFile("src/features/planning/model/supporting-planning-shell-projection.ts", "utf8"),
  ]);
  for (const workspace of ["events", "tools", "team", "profile", "notifications"]) {
    assert.match(page, new RegExp(`createSupabase${workspace === "events" ? "Events" : workspace === "tools" ? "Tools" : workspace === "team" ? "Team" : workspace === "profile" ? "Profile" : "Notifications"}ReadModel`));
  }
  assert.match(apiClient, /requestSupportingWorkspaceData/);
  assert.match(adapter, /SupportingWorkspaceModel/);
  assert.doesNotMatch(adapter, /server\//);
  await assert.rejects(() => readFile("src/lib/planning-data-scopes.ts", "utf8"), /ENOENT/);
});

test("consumer-owned read-model interfaces do not import peer server modules", async () => {
  const files = [
    "src/features/events/model/events-read-model.ts",
    "src/features/tools/model/tools-read-model.ts",
    "src/features/team/model/team-read-model.ts",
    "src/features/profile/model/profile-read-model.ts",
    "src/features/notifications/model/notifications-read-model.ts",
  ];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    assert.match(source, /interface \w+ReadModel[\s\S]*load\(/);
    assert.doesNotMatch(source, /server\//);
    assert.doesNotMatch(source, /PlanningShellState/);
  }
});
