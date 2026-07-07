import { NextResponse } from "next/server";
import { getPlanningData } from "@/lib/planning-data";
import { getServerSupabase, hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

const coreTables = ["profiles", "packages", "tasks"] as const;

async function coreTablesReachable() {
  const supabase = getServerSupabase();
  if (!supabase) return false;

  const checks = await Promise.all(coreTables.map(async (table) => {
    const { error } = await supabase.from(table).select("id").limit(1);
    return !error;
  }));
  return checks.every(Boolean);
}

export async function GET() {
  const startedAt = Date.now();
  const [{ source }, coreTablesReady] = await Promise.all([getPlanningData(), coreTablesReachable()]);

  const checks = {
    supabaseConfigured: hasSupabaseEnv(),
    usesSupabaseData: source === "supabase",
    coreTablesReachable: coreTablesReady,
  };

  const ready = Object.values(checks).every(Boolean);

  return NextResponse.json(
    {
      status: ready ? "ready" : "degraded",
      source,
      env: {
        supabaseConfigured: hasSupabaseEnv(),
        authRequired: requiresSupabaseAuth(),
      },
      checks,
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
