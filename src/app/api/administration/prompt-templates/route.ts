import { NextResponse, type NextRequest } from "next/server";
import { isPlanningPromptTemplateAudienceEdit, isPlanningPromptTemplateKind } from "@/features/planning-items/model/planning-prompt-templates";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administration.prompt-templates.read" });
  if (!permission.ok) return authzError(permission);

  const [templates, audienceDirectory] = await Promise.all([
    permission.administrator.readPromptTemplates(),
    permission.administrator.readPromptTemplateAudience(),
  ]);
  if (templates.error?.code === "42501" || audienceDirectory.error?.code === "42501") {
    return authzError(await permission.administrator.failure());
  }
  if (templates.error || !templates.data || audienceDirectory.error || !audienceDirectory.data || !permission.profile) {
    return apiError("Prompt-Vorlagen konnten nicht geladen werden.", 503);
  }
  return NextResponse.json(
    { profileId: permission.profile.id, templates: templates.data, ...audienceDirectory.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administration.prompt-templates.publish" });
  if (!permission.ok) return authzError(permission);

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
    Object.keys(payload).length !== 3 || !isPlanningPromptTemplateKind(payload.kind) ||
    typeof payload.text !== "string" || !payload.text.trim() ||
    !Number.isInteger(payload.expectedVersion) || payload.expectedVersion < 1 ||
    payload.expectedVersion > 2_147_483_647) {
    return apiError("Prompt-Vorlage ist ungültig.", 400);
  }

  const { data, error } = await permission.administrator.publishPromptTemplate(payload);
  if (error?.code === "42501") return authzError(await permission.administrator.failure());
  if (error?.code === "P0001") {
    return apiError("Die aktive Fassung hat sich geändert. Lade sie neu und prüfe deinen Entwurf.", 409);
  }
  if (error?.code === "22023") return apiError("Prompt-Vorlage ist ungültig.", 400);
  if (error || !data) return apiError("Prompt-Vorlage konnte nicht veröffentlicht werden.", 503);
  return NextResponse.json({ template: data });
}

export async function PATCH(request: NextRequest) {
  const permission = await authorizeCredentialAction({
    credential: { kind: "session-request", request },
    action: "administration.prompt-templates.audience.save",
  });
  if (!permission.ok) return authzError(permission);

  const payload: unknown = await request.json().catch(() => null);
  if (!isPlanningPromptTemplateAudienceEdit(payload)) return apiError("Die Zielgruppe ist ungültig.", 400);

  const { data, error } = await permission.administrator.savePromptTemplateAudience(payload);
  if (error?.code === "42501") return authzError(await permission.administrator.failure());
  if (error?.code === "22023" || error?.code === "23503") {
    return apiError("Die Zielgruppe ist ungültig. Lade sie neu und prüfe die Profilauswahl.", 400);
  }
  if (error || !data) return apiError("Die Zielgruppe konnte nicht gespeichert werden.", 503);
  return NextResponse.json({ audience: data });
}
