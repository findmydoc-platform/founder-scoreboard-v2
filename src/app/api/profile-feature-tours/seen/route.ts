import { NextResponse, type NextRequest } from "next/server";
import { requireTeamMember } from "@/lib/authz";
import { mapProfileFeatureTourAcknowledgement } from "@/lib/planning-data-mappers";
import type { DbProfileFeatureTourAcknowledgement } from "@/lib/planning-data-row-types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type Payload = {
  tourId?: string;
};

function cleanTourId(value: unknown) {
  if (typeof value !== "string") return "";
  const tourId = value.trim();
  return /^[a-z0-9][a-z0-9._-]{1,80}$/.test(tourId) ? tourId : "";
}

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<Payload>(request, requireTeamMember, {});
  if (!context.ok) return context.response;

  const profileId = context.permission.profile?.id || "";
  if (!profileId) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const tourId = cleanTourId(context.payload.tourId);
  if (!tourId) return apiError("Tour-ID ist ungültig.", 400);

  const { data, error } = await context.supabase
    .from("profile_feature_tour_acknowledgements")
    .upsert({
      profile_id: profileId,
      tour_id: tourId,
      seen_at: new Date().toISOString(),
    }, { onConflict: "profile_id,tour_id" })
    .select("profile_id,tour_id,seen_at")
    .single<DbProfileFeatureTourAcknowledgement>();

  if (error) return apiError(error.message, error.code === "42P01" ? 503 : 500);

  return NextResponse.json({ acknowledgement: mapProfileFeatureTourAcknowledgement(data) });
}
