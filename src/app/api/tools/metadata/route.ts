import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requireTeamMember } from "@/lib/authz";
import { loadFmdToolMetadata } from "@/lib/fmd-tool-metadata";

export const runtime = "nodejs";

type MetadataPayload = {
  url?: string;
};

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<MetadataPayload>(request, requireTeamMember, {});
  if (!context.ok) return context.response;

  const url = cleanText(context.payload.url, 1000);
  if (!url) return apiError("URL ist erforderlich.", 400);

  try {
    const metadata = await loadFmdToolMetadata(url);
    return NextResponse.json({ ok: true, metadata });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Metadaten konnten nicht geladen werden.", 400);
  }
}
