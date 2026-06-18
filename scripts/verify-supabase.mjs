import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = resolve(process.cwd(), ".env.local");

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const separator = trimmed.indexOf("=");
  if (separator < 0) return null;

  const key = trimmed.slice(0, separator).trim();
  const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
  return [key, value];
}

if (existsSync(envPath)) {
  const envFile = await readFile(envPath, "utf8");
  for (const pair of envFile.split(/\r?\n/).map(parseEnvLine)) {
    if (!pair) continue;
    const [key, value] = pair;
    process.env[key] ||= value;
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error("Missing Supabase env. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

async function count(table) {
  const { count: rowCount, error } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(`${table}: ${error.message}`);
  return rowCount ?? 0;
}

const schemaChecks = [
  { name: "profiles.google_chat", table: "profiles", select: "id,google_chat_user_id,google_chat_dm_space,notifications_enabled" },
  { name: "profiles.google_calendar", table: "profiles", select: "id,google_calendar_email,google_calendar_sync_enabled,google_calendar_last_synced_at" },
  { name: "notification_preferences", table: "notification_preferences", select: "id,profile_id,channel,event_type,enabled" },
  { name: "notification_events.dedupe_key", table: "notification_events", select: "id,dedupe_key" },
  { name: "notification_deliveries.payload", table: "notification_deliveries", select: "id,target,payload" },
  { name: "tasks.carryover", table: "tasks", select: "id,original_sprint_id,carried_from_task_id,carried_from_sprint_id,carryover_reason,carryover_count,sprint_outcome" },
  { name: "tasks.accountable_review", table: "tasks", select: "id,review_owner_profile_id,review_requested_at" },
  { name: "sprint_commitments", table: "sprint_commitments", select: "id,sprint_id,profile_id,commitment_level,weekly_hours,note" },
  { name: "founder_sprint_scores", table: "founder_sprint_scores", select: "id,sprint_id,profile_id,delivery_points,form_points,weekly_points,total_points,fulfilled,away_neutral,finalized_at,finalized_by,reason_summary" },
  { name: "founder_strike_state", table: "founder_strike_state", select: "id,profile_id,strike_level,fulfilled_reset_streak,last_evaluated_sprint_id,updated_at" },
  { name: "strike_events", table: "strike_events", select: "id,profile_id,sprint_id,event_type,previous_strike_level,next_strike_level,reason,created_by" },
  { name: "score_objections", table: "score_objections", select: "id,sprint_id,profile_id,founder_sprint_score_id,status,comment,resolution_comment,reviewed_by,second_reviewer_profile_id" },
  { name: "tasks.self_checklist", table: "tasks", select: "id,self_dod_checked,self_evidence_checked,self_documented_checked,self_blockers_checked" },
  { name: "tasks.milestone", table: "tasks", select: "id,milestone_id" },
  { name: "tasks.created_by", table: "tasks", select: "id,created_by" },
  { name: "packages.initiative", table: "packages", select: "id,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,consulted_profile_ids,informed_profile_ids,title,goal,priority,status,target_date,success_criteria,scope_constraints" },
  { name: "tasks.template_v2", table: "tasks", select: "id,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,dod_template_version" },
  { name: "milestones", table: "milestones", select: "id,title,target_date,status" },
  { name: "feedback_items", table: "feedback_items", select: "id,type,status,severity,profile_id,title,description,page_url" },
  { name: "fmd_tools", table: "fmd_tools", select: "id,name,category,kind,url,owner,status,sort_order" },
  { name: "task_relationship_edges", table: "task_relationship_edges", select: "id,task_id,related_task_id,relation_type,note" },
  { name: "task_external_comments", table: "task_external_comments", select: "id,task_id,source,external_id,author_login,body,html_url" },
  { name: "task_focus_items", table: "task_focus_items", select: "id,profile_id,task_id,focus_date,position,next_step,status" },
  { name: "decision_task_links", table: "decision_task_links", select: "id,decision_id,task_id,link_type,note,created_by" },
  { name: "availability.calendar_sync", table: "availability", select: "id,title,blocker_kind,source,external_id,external_calendar_id,synced_at" },
  { name: "meetings.google_calendar_sync", table: "meetings", select: "id,duration_minutes,google_calendar_id,google_calendar_event_id,google_calendar_sync_status" },
  { name: "founder_events", table: "founder_events", select: "id,title,category,starts_at,ends_at,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status" },
];

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
