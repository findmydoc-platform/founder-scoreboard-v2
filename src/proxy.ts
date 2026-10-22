import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { matchRuntimeRoute } from "@/lib/runtime-logging/routes";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/github/webhooks") {
    return NextResponse.next();
  }
  if (matchRuntimeRoute(request.method, request.nextUrl.pathname)) {
    const { observeRuntimeProxy } = await import("@/lib/runtime-logging");
    return observeRuntimeProxy(request, () => authorizeCredentialAction({ credential: { kind: "http-request", request }, action: "session.proxy" }));
  }
  return authorizeCredentialAction({ credential: { kind: "http-request", request }, action: "session.proxy" });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
