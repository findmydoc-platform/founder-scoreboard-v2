import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-response";
import { getPlanningData } from "@/lib/planning-data";
import { getDemoSeedImportAvailability, importDemoSeed } from "@/lib/seed/demo-import";
import { getServerSupabase } from "@/lib/supabase";

export async function POST() {
  const supabase = getServerSupabase();
  const availability = await getDemoSeedImportAvailability(supabase);
  if (!availability.available) return apiError(availability.error, availability.status);
  if (!supabase) return apiError("Supabase env is not configured.", 501);

  const { source } = await getPlanningData();
  if (source !== "seed") {
    return apiError("Demo-Import ist nur im lokalen Fallback verfügbar.", 409);
  }

  try {
    const imported = await importDemoSeed(supabase);
    return NextResponse.json({ imported });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Demo-Import konnte nicht ausgeführt werden.";
    return apiError(message, 500);
  }
}
