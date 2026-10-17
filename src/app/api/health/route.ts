import { authorizeCredentialAction } from "@/lib/credentials";
import { NextResponse } from "next/server";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase-configuration";

export async function GET() {
  const startedAt = Date.now();
  const permission = await authorizeCredentialAction({ credential: { kind: "public-resource" }, action: "health.inspect" });
  const coreTablesReady = await permission.publicResource.coreTablesReachable();
  const source = "supabase" as const;

  const checks = {
    supabaseConfigured: hasSupabaseEnv(),
    usesSupabaseData: hasSupabaseEnv(),
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
