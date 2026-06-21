import { NextResponse } from "next/server";
import { googleChatDeliveryStatus } from "@/lib/google-chat";
import planningSchemaCheckConfig from "@/lib/planning-schema-checks.json";
import { getPlanningData } from "@/lib/planning-data";
import { seedData } from "@/lib/seed";
import { getServerSupabase, hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

const expected = {
  profiles: seedData.profiles.length,
  packages: seedData.packages.length,
  tasksMin: seedData.tasks.length,
};

type SchemaCheckConfig = {
  name: string;
  table: string;
  select?: string;
  healthSelect?: string;
  verifySelect?: string;
  health: boolean;
};

const schemaChecks = (planningSchemaCheckConfig as SchemaCheckConfig[])
  .filter((check) => check.health)
  .map((check) => ({
    name: check.name,
    table: check.table,
    select: check.healthSelect || check.select || check.verifySelect || "id",
  }));

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
    tasks: counts.tasks >= expected.tasksMin,
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
        githubSyncMode: "logged_in_user",
        googleChat: googleChatDeliveryStatus(),
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
