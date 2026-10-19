import type { NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { authzError, readJsonPayload } from "@/lib/api-response";
import type { EventPayload } from "./event-api";

export async function eventApiContext(request: NextRequest, action: "events.create" | "events.update", targetId?: string) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action, targetId });
  if (!permission.ok) return { ok: false as const, response: authzError(permission) };
  const payload = await readJsonPayload<EventPayload>(request, {});
  return { ok: true as const, permission, resource: permission.resource, payload };
}
