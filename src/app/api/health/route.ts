import { NextResponse } from "next/server";
import { getPlanningData } from "@/lib/planning-data";
import { getServerSupabase, hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

const expected = {
  profiles: 5,
  packages: 5,
  tasks: 53,
};

const schemaChecks = [
  { name: "profiles.google_chat", table: "profiles", select: "id,google_chat_user_id,google_chat_dm_space,notifications_enabled" },
  { name: "notification_preferences", table: "notification_preferences", select: "id,profile_id,channel,event_type,enabled" },
  { name: "notification_deliveries.payload", table: "notification_deliveries", select: "id,target,payload" },
  { name: "tasks.carryover", table: "tasks", select: "id,original_sprint_id,carried_from_task_id,carried_from_sprint_id,carryover_reason,carryover_count,sprint_outcome" },
  { name: "tasks.self_checklist", table: "tasks", select: "id,self_dod_checked,self_evidence_checked,self_documented_checked,self_blockers_checked" },
  { name: "tasks.milestone", table: "tasks", select: "id,milestone_id" },
  { name: "milestones", table: "milestones", select: "id,title,target_date,status" },
];

async function checkSchema() {
  const supabase = getServerSupabase();
  if (!supabase) return schemaChecks.map((check) => ({ name: check.name, ok: false, error: "Supabase env missing" }));

  return Promise.all(schemaChecks.map(async (check) => {
    const { error } = await supabase.from(check.table).select(check.select).limit(1);
    return {
      name: check.name,
      ok: !error,
      error: error?.message || "",
    };
  }));
}

export async function GET() {
  const startedAt = Date.now();
  const [{ data, source }, schema] = await Promise.all([getPlanningData(), checkSchema()]);

  const counts = {
    profiles: data.profiles.length,
    packages: data.packages.length,
    tasks: data.tasks.length,
  };

  const countChecks = {
    profiles: counts.profiles === expected.profiles,
    packages: counts.packages === expected.packages,
    tasks: counts.tasks === expected.tasks,
  };

  const schemaReady = schema.every((check) => check.ok);
  const ready = source === "supabase" && countChecks.profiles && countChecks.packages && countChecks.tasks && schemaReady;

  return NextResponse.json(
    {
      status: ready ? "ready" : "degraded",
      source,
      env: {
        supabaseConfigured: hasSupabaseEnv(),
        authRequired: requiresSupabaseAuth(),
      },
      counts,
      expected,
      checks: countChecks,
      schema,
      durationMs: Date.now() - startedAt,
    },
    {
      status: ready ? 200 : 503,
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
