import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireTeamMember } from "@/lib/authz";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";

const founderProjectId = "findmydoc-founder-execution";

export async function GET(request: NextRequest) {
  const apiContext = await requireApiContext(request, requireTeamMember, {
    supabaseUnavailableMessage: "Planungsänderungen konnten nicht geprüft werden.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { data, error, count } = await apiContext.supabase
    .from(ACTIVE_TASKS_TABLE)
    .select("updated_at", { count: "exact" })
    .eq("project_id", founderProjectId)
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) return apiError("Planungsänderungen konnten nicht geprüft werden.", 500);

  return NextResponse.json({
    revision: {
      activeTaskCount: count || 0,
      latestUpdatedAt: String(data?.[0]?.updated_at || ""),
    },
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
