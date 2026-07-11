import { NextRequest, NextResponse } from "next/server";

import { requireAgentScope } from "@/lib/agent-auth";
import { getAgentTasks } from "@/lib/agent-data";
import { isPlanningDataUnavailableError } from "@/lib/planning-data-availability";

function booleanFilter(value: string | null) {
  return value === "true" ? true : undefined;
}

export async function GET(request: NextRequest) {
  const permission = requireAgentScope(request, "read:planning");
  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  const searchParams = request.nextUrl.searchParams;
  try {
    const result = await getAgentTasks({
      assignee: searchParams.get("assignee") || searchParams.get("owner") || undefined,
      sprint: searchParams.get("sprint") || undefined,
      initiative: searchParams.get("initiative") || undefined,
      status: searchParams.get("status") || undefined,
      reviewOwner: searchParams.get("reviewOwner") || undefined,
      missingEvidence: booleanFilter(searchParams.get("missingEvidence")),
      blocked: booleanFilter(searchParams.get("blocked")),
      limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (isPlanningDataUnavailableError(error)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    throw error;
  }
}
