import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, authzError } from "@/lib/api-response";
import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";

async function handleGET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.revision.read" });
  if (!permission.ok) return authzError(permission);
  const result = await permission.planning.readSourceVersion({ signal: request.signal });
  if (result.error || result.version === null) return apiError("Planungsänderungen konnten nicht geprüft werden.", "status" in result ? result.status : 503);
  return observeRuntimePreparation(() => NextResponse.json({ version: result.version }, { headers: { "Cache-Control": "private, no-store" } }));
}

export const GET = observeRuntimeHandler("planning.source-version", handleGET);
