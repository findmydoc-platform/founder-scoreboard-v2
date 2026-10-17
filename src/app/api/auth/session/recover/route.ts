import type { NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";

export function POST(request: NextRequest) {
  return authorizeCredentialAction({ credential: { kind: "http-request", request }, action: "session.recover" });
}
