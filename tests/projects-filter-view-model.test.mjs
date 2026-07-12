import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("project hierarchy search finds milestones and empty initiatives", async () => {
  const { buildProjectsFilterViewModel } = await loadTranspiledModule(
    "src/features/projects/model/projects-filter-view-model.ts",
    {
      "@/lib/status": { normalizeStatus: (status) => status },
    },
  );
  const data = {
    milestones: [{
      id: "milestone-expansion",
      title: "Expansion 2027",
      description: "New market preparation",
      targetDate: "",
      status: "planned",
      sortOrder: 1,
    }],
    packages: [{
      id: "initiative-empty",
      milestoneId: "milestone-expansion",
      title: "Leere Initiative",
      goal: "Prepare later",
      priority: "P2",
      sortOrder: 1,
    }],
  };

  const byMilestone = buildProjectsFilterViewModel({
    data,
    tasks: [],
    query: "Expansion",
    ownerFilter: "Alle",
    statusFilter: "Alle",
  });
  const byInitiative = buildProjectsFilterViewModel({
    data,
    tasks: [],
    query: "Leere Initiative",
    ownerFilter: "Alle",
    statusFilter: "Alle",
  });

  assert.equal(byMilestone.hierarchy[0].milestone.id, "milestone-expansion");
  assert.equal(byMilestone.hierarchy[0].initiatives[0].initiative.id, "initiative-empty");
  assert.equal(byInitiative.hierarchy[0].initiatives[0].initiative.id, "initiative-empty");
  assert.equal(byInitiative.visibleCount, 2);
  assert.equal(byInitiative.totalCount, 2);
});
