import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/api/github/webhooks") {
    return NextResponse.next();
  }
  if (request.method === "GET" && request.nextUrl.pathname === "/api/team-workweek/team") {
    const { observeCalendarProxy } = await import("@/lib/runtime-logging");
    return observeCalendarProxy(request, () => authorizeCredentialAction({ credential: { kind: "http-request", request }, action: "session.proxy" }));
  }
  return authorizeCredentialAction({ credential: { kind: "http-request", request }, action: "session.proxy" });
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
