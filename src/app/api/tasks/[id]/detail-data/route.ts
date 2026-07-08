import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlatformRole } from "@/lib/authz";
import { loadTaskDetailData } from "@/lib/task-detail-data";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(
    request,
    (currentRequest) => requirePlatformRole(currentRequest, ["ceo", "founder", "deputy", "viewer"]),
  );
  if (!apiContext.ok) return apiContext.response;

  const { id } = await context.params;
  const result = await loadTaskDetailData(apiContext.supabase, id);
  if (!result.ok) return apiError(result.error, result.status);

  return NextResponse.json({ detailData: result.data });
}
