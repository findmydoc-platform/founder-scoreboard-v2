import "server-only";
import type { NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import type { PlanningCredentialInput } from "@/lib/credentials/types";
import { apiError, authzError, readJsonPayload } from "@/lib/api-response";

export async function requirePlanningContext(request: NextRequest, action: PlanningCredentialInput["action"], targetId?: string, unavailableMessage?: string, targetIds?: readonly string[]) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action, targetId, targetIds });
  if (!permission.ok) return { ok: false as const, response: permission.status === 501 && unavailableMessage ? apiError(unavailableMessage, 501) : authzError(permission), status: permission.status, error: permission.error, code: "code" in permission ? permission.code : undefined };
  return { ok: true as const, permission, planning: permission.planning };
}

export async function requirePlanningJsonContext<T>(request: NextRequest, action: PlanningCredentialInput["action"], fallback: T, targetId?: string) {
  const context = await requirePlanningContext(request, action, targetId);
  if (!context.ok) return context;
  return { ...context, payload: await readJsonPayload<T>(request, fallback) };
}
