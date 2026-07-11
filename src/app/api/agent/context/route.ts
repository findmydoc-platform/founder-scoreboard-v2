import { NextRequest, NextResponse } from "next/server";
import { buildAgentContext } from "@/features/agent/model/agent-data-service";
import { handleAgentRequest } from "@/features/agent/model/agent-route-handler";

export async function GET(request: NextRequest) {
  return handleAgentRequest(request, "read:planning", async () => {
    const { context, source } = await buildAgentContext();
    return NextResponse.json({ ok: true, source, context });
  });
}
