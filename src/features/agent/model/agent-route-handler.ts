import { NextResponse, type NextRequest } from "next/server";
import { requireAgentScope } from "@/features/agent/model/agent-auth";
import type { AgentScope } from "@/features/agent/model/agent-contract";
import { isPlanningDataUnavailableError } from "@/lib/planning-data-availability";

type AgentRouteHandler = () => Promise<Response>;

export async function handleAgentRequest(
  request: NextRequest,
  scope: AgentScope,
  handler: AgentRouteHandler,
) {
  const permission = requireAgentScope(request, scope);
  if (!permission.ok) {
    return NextResponse.json({ ok: false, error: permission.error }, { status: permission.status });
  }

  try {
    return await handler();
  } catch (error) {
    if (isPlanningDataUnavailableError(error)) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 503 });
    }
    throw error;
  }
}
