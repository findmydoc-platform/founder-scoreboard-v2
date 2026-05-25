import { readFile } from "node:fs/promises";

const checks = [
  ["docs/planning-hierarchy.md", /Epic \/ Meilenstein[\s\S]*Group Commitment[\s\S]*Deliverable[\s\S]*Sub-Issue/],
  ["AGENTS.md", /Epic \/ Milestone -> Group Commitment -> Deliverable -> Sub-Issue/],
  ["supabase/0013_epic_group_commitment_hierarchy.sql", /packages add column if not exists milestone_id/],
  ["src/lib/types.ts", /milestoneId\?: string/],
  ["src/lib/github.ts", /Epic \/ Milestone/],
  ["src/lib/github.ts", /Group Commitment/],
  ["src/components/planning-app.tsx", /Epic \/ Meilenstein/],
  ["src/components/planning-app.tsx", /Group Commitment/],
  ["src/components/task-detail-page.tsx", /Epic \/ Meilenstein/],
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
