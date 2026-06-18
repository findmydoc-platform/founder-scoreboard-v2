import { readFile } from "node:fs/promises";

const checks = [
  ["docs/planning-hierarchy.md", /Epic \/ Meilenstein[\s\S]*Initiative[\s\S]*Deliverable[\s\S]*Sub-Issue/],
  ["AGENTS.md", /Epic \/ Milestone -> Initiative -> Deliverable -> Sub-Issue/],
  ["supabase/0013_epic_group_commitment_hierarchy.sql", /packages add column if not exists milestone_id/],
  ["supabase/0027_initiative_structure.sql", /owner_id[\s\S]*success_criteria[\s\S]*scope_constraints/],
  ["supabase/0028_initiative_raci.sql", /accountable_profile_id[\s\S]*responsible_profile_ids[\s\S]*consulted_profile_ids[\s\S]*informed_profile_ids/],
  ["src/lib/types.ts", /milestoneId\?: string/],
  ["src/lib/github.ts", /Epic \/ Milestone/],
  ["src/lib/github.ts", /Initiative/],
  ["src/features/planning/PlanningApp.tsx", /Initiative/],
  ["src/features/projects/organisms/projects-overview.tsx", /Epic \/ Meilenstein[\s\S]*Initiative[\s\S]*Deliverable[\s\S]*Sub-Issue/],
  ["src/features/projects/organisms/initiative-dialog.tsx", /Epic \/ Meilenstein/],
  ["src/features/tasks/organisms/new-task-dialog.tsx", /Deliverables brauchen Epic, Initiative und Sprint/],
  ["src/features/tasks/organisms/task-detail-panel-sidebar.tsx", /Epic \/ Meilenstein/],
];

const failures = [];

for (const [file, pattern] of checks) {
  const content = await readFile(file, "utf8");
  if (!pattern.test(content)) failures.push(`${file} does not match ${pattern}`);
}

if (failures.length) {
  console.error("Hierarchy verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Hierarchy verification passed.");
