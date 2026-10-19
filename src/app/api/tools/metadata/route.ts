import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { apiError, authzError, readJsonPayload } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export const runtime = "nodejs";

type MetadataPayload = {
  url?: string;
};

export async function POST(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "tools.metadata" });
  if (!permission.ok) return authzError(permission);
  const payload = await readJsonPayload<MetadataPayload>(request, {});

  const url = cleanText(payload.url, 1000);
  if (!url) return apiError("URL ist erforderlich.", 400);

  try {
    const metadata = await permission.resource.loadMetadata(url);
    return NextResponse.json({ ok: true, metadata });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Metadaten konnten nicht geladen werden.", 400);
  }
}
