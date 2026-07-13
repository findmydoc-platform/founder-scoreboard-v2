import { readFile } from "node:fs/promises";
import { readSupabaseMigrationCorpus } from "./lib/supabase-migrations.mjs";

const migrationCorpus = await readSupabaseMigrationCorpus();

const checks = [
  ["docs/planning-hierarchy.md", /Epic \/ Meilenstein[\s\S]*Initiative[\s\S]*Deliverable[\s\S]*Sub-Issue/],
  ["AGENTS.md", /Epic \/ Milestone -> Initiative -> Deliverable -> Sub-Issue/],
  ["Supabase migration corpus", /CREATE TABLE IF NOT EXISTS "public"\."packages"[^]*"milestone_id"/i, migrationCorpus],
  ["Supabase migration corpus", /"owner_id"[^]*"success_criteria"[^]*"scope_constraints"/i, migrationCorpus],
  ["Supabase migration corpus", /"accountable_profile_id"[^]*"responsible_profile_ids"[^]*"consulted_profile_ids"[^]*"informed_profile_ids"/i, migrationCorpus],
  ["src/lib/types.ts", /milestoneId\?: string/],
  ["src/features/projects/organisms/projects-overview.tsx", /Epic \/ Meilenstein[\s\S]*Initiative[\s\S]*Deliverable[\s\S]*Sub-Issue/],
  ["src/features/projects/organisms/initiative-dialog.tsx", /Epic \/ Meilenstein/],
  ["src/features/tasks/organisms/new-task-dialog.tsx", /Deliverables brauchen eine Initiative und starten als vorgeschlagen/],
  ["src/features/tasks/organisms/new-task-dialog.tsx", /Nach Freigabe zuweisen/],
  ["Supabase migration corpus", /tasks_approval_status_by_type_check[^]*task_type" = 'sub_issue'[^]*approval_status" IS NULL/i, migrationCorpus],
  ["Supabase migration corpus", /tasks_score_relevance_approval_check[^]*task_type" = 'deliverable'[^]*approval_status" = 'approved'[^]*sprint_id" IS NOT NULL/i, migrationCorpus],
  ["src/features/tasks/organisms/task-detail-panel-sidebar.tsx", /Epic \/ Meilenstein/],
];

const failures = [];

for (const [file, pattern, providedContent] of checks) {
  const content = providedContent || await readFile(file, "utf8");
  if (!pattern.test(content)) failures.push(`${file} does not match ${pattern}`);
}

if (failures.length) {
  console.error("Hierarchy verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Hierarchy verification passed.");
