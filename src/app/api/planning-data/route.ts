import { NextResponse, type NextRequest } from "next/server";
import { requirePlatformRole } from "@/lib/authz";
import { getPlanningData } from "@/lib/planning-data";
import { authzError } from "@/lib/api-response";

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRole(request, ["ceo", "founder", "deputy", "viewer"]);
  if (!auth.ok) return authzError(auth);

  const result = await getPlanningData();
  return NextResponse.json({ ...result, currentProfile: auth.profile });
}
