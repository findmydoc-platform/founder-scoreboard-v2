import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { mapProfileFeatureTourAcknowledgement } from "@/lib/planning-row-mappers";
import { apiError, authzError } from "@/lib/api-response";

type Payload = {
  tourId?: string;
};

function cleanTourId(value: unknown) {
  if (typeof value !== "string") return "";
  const tourId = value.trim();
  return /^[a-z0-9][a-z0-9._-]{1,80}$/.test(tourId) ? tourId : "";
}

export async function POST(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "account.tour.acknowledge" });
  if (!permission.ok) return authzError(permission);
  const payload = await request.json().catch(() => ({})) as Payload;
  const profileId = permission.profile?.id || "";
  if (!profileId) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const tourId = cleanTourId(payload.tourId);
  if (!tourId) return apiError("Tour-ID ist ungültig.", 400);

  const { data, error } = await permission.account.acknowledgeTour(tourId);

  if (error) return apiError(error.message, error.code === "42P01" ? 503 : 500);

  return NextResponse.json({ acknowledgement: mapProfileFeatureTourAcknowledgement(data!) });
}
