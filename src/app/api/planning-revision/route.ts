import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

async function handleGET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.revision.read" });
  if (!permission.ok) return permission.status === 501 ? apiError("Planungsänderungen konnten nicht geprüft werden.", 501) : authzError(permission);
  const { data, error, count } = await permission.planning.readRevision();
  if (error) return apiError("Planungsänderungen konnten nicht geprüft werden.", 500);

  return observeRuntimePreparation(() => NextResponse.json({
    revision: {
      activeTaskCount: count ?? 0,
      latestUpdatedAt: String(data?.[0]?.updated_at || ""),
    },
  }, {
    headers: { "Cache-Control": "private, no-store" },
  }));
}

export const GET = observeRuntimeHandler("planning.revision", handleGET);
