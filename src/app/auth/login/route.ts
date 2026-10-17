import { NextResponse, type NextRequest } from "next/server";
import { safeRelativeNext } from "@/lib/auth-redirect";

export function GET(request: NextRequest) {
  const target = new URL("/auth/start", request.url);
  target.searchParams.set("next", safeRelativeNext(request.nextUrl.searchParams.get("next")));
  if (request.nextUrl.searchParams.get("provider") === "github") target.searchParams.set("provider", "github");
  return NextResponse.redirect(target);
}
