import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.revision.read" });
  if (!permission.ok) return permission.status === 501 ? apiError("Planungsänderungen konnten nicht geprüft werden.", 501) : authzError(permission);
  const { data, error, count } = await permission.planning.readRevision();
  if (error) return apiError("Planungsänderungen konnten nicht geprüft werden.", 500);

  return NextResponse.json({
    revision: {
      activeTaskCount: count ?? 0,
      latestUpdatedAt: String(data?.[0]?.updated_at || ""),
    },
  }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
