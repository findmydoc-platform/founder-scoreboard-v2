import { readFile } from "node:fs/promises";
import { createSupabaseScriptClient } from "./lib/supabase.mjs";

const supabase = await createSupabaseScriptClient();

async function count(table) {
  const { count: rowCount, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return rowCount ?? 0;
}

const schemaCheckConfig = JSON.parse(
  await readFile(new URL("../src/lib/planning-schema-checks.json", import.meta.url), "utf8"),
);
const schemaChecks = schemaCheckConfig.map((check) => ({
  name: check.name,
  table: check.table,
  select: check.verifySelect || check.select || check.healthSelect || "id",
}));

async function checkSchema(check) {
  const { error } = await supabase.from(check.table).select(check.select).limit(1);
  return {
    name: check.name,
    ok: !error,
    error: error?.message || "",
  };
}

const { data: project, error: projectError } = await supabase
  .from("projects")
  .select("id,name,range_label")
  .eq("id", "findmydoc-founder-execution")
  .single();

if (projectError) throw new Error(`projects: ${projectError.message}`);

const result = {
  project: project.name,
  range: project.range_label,
  profiles: await count("profiles"),
  githubAppConnections: await count("github_app_user_tokens"),
  packages: await count("packages"),
  tasks: await count("tasks"),
  dependencies: await count("task_dependencies"),
  links: await count("task_links"),
  notes: await count("task_notes"),
  activity: await count("task_activity"),
  sprints: await count("sprints"),
  sprintCommitments: await count("sprint_commitments"),
  founderSprintScores: await count("founder_sprint_scores"),
  founderStrikeStates: await count("founder_strike_state"),
  strikeEvents: await count("strike_events"),
  scoreObjections: await count("score_objections"),
  reviews: await count("task_reviews"),
  decisions: await count("decision_log"),
  audit: await count("audit_log"),
  availability: await count("availability"),
  comments: await count("task_comments"),
  externalComments: await count("task_external_comments"),
  blockers: await count("task_blockers"),
  relationships: await count("task_relationship_edges"),
  focusItems: await count("task_focus_items"),
  decisionTaskLinks: await count("decision_task_links"),
  notifications: await count("notification_events"),
  notificationDeliveries: await count("notification_deliveries"),
  meetings: await count("meetings"),
  meetingAttendance: await count("meeting_attendance"),
  events: await count("founder_events"),
  milestones: await count("milestones"),
  schema: await Promise.all(schemaChecks.map(checkSchema)),
};

console.log(JSON.stringify(result, null, 2));

const missingSchema = result.schema.filter((check) => !check.ok);
if (missingSchema.length) {
  console.error("Supabase schema is incomplete. Run the missing migrations in order, especially 0008_google_chat_delivery.sql, 0009_sprint_carryover.sql and 0010_task_self_checklist.sql.");
  process.exit(1);
}
