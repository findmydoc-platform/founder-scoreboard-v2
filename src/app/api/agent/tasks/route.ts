import { NextRequest, NextResponse } from "next/server";
import { getAgentTasks } from "@/features/agent/model/agent-data-service";
import { handleAgentRequest } from "@/features/agent/model/agent-route-handler";

function booleanFilter(value: string | null) {
  return value === "true" ? true : undefined;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  return handleAgentRequest(request, "read:planning", async () => {
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
  });
}
