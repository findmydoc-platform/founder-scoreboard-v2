import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";

type CreateTokenPayload = {
  label?: unknown;
  allowUpdates?: unknown;
  allowEmptyEpicDeletes?: unknown;
  allowGitHubSync?: unknown;
};

export async function GET(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning-items.tokens.manage" });
  if (!permission.ok) return authzError(permission);
  const canIssueEmptyEpicDeletes = permission.profile?.platformRole === "ceo"
    || permission.profile?.platformRole === "deputy";

  const { data, error } = await permission.tokens.list();
  if (error) return apiError(error.code === "42P01" ? "Planning-API-Schema ist noch nicht verfügbar." : "Planning-API-Tokens konnten nicht geladen werden.", error.code === "42P01" ? 503 : 500);

  return NextResponse.json({
    ok: true,
    capabilities: {
      canIssueEmptyEpicDeletes,
    },
    tokens: data
      .map((token) => canIssueEmptyEpicDeletes
        ? token
        : { ...token, scopes: token.scopes.filter((scope) => scope !== "write:planning-items:delete-empty") }),
  });
}

export async function POST(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning-items.tokens.manage" });
  if (!permission.ok) return authzError(permission);
  const payload = await request.json().catch(() => ({})) as CreateTokenPayload | null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return apiError("Token-Payload muss ein JSON-Objekt sein.", 400);
  }
  const unknownField = Object.keys(payload).find((key) => ![
    "label",
    "allowUpdates",
    "allowEmptyEpicDeletes",
    "allowGitHubSync",
  ].includes(key));
  if (unknownField) return apiError(`Token-Payload enthält das unbekannte Feld ${unknownField}.`, 400);

  const label = cleanText(payload.label, 80);
  if (!label) return apiError("Token-Bezeichnung ist erforderlich.", 400);
  if (payload.allowUpdates !== undefined && typeof payload.allowUpdates !== "boolean") {
    return apiError("allowUpdates muss wahr oder falsch sein.", 400);
  }
  if (payload.allowEmptyEpicDeletes !== undefined && typeof payload.allowEmptyEpicDeletes !== "boolean") {
    return apiError("allowEmptyEpicDeletes muss wahr oder falsch sein.", 400);
  }
  if (payload.allowGitHubSync !== undefined && typeof payload.allowGitHubSync !== "boolean") {
    return apiError("allowGitHubSync muss wahr oder falsch sein.", 400);
  }
  const allowEmptyEpicDeletes = payload.allowEmptyEpicDeletes;
  const canIssueEmptyEpicDeletes = permission.profile?.platformRole === "ceo"
    || permission.profile?.platformRole === "deputy";
  if (allowEmptyEpicDeletes === true && !canIssueEmptyEpicDeletes) {
    return apiError("Nur CEO oder Deputy können Tokens zum Löschen leerer Epics erstellen.", 403);
  }

  const { data, error } = await permission.tokens.issue({ label, allowUpdates: payload.allowUpdates === true,
    allowEmptyEpicDeletes: allowEmptyEpicDeletes === true, allowGitHubSync: payload.allowGitHubSync === true });

  if (error) {
    if (error.code === "P0003") return apiError("Maximal drei aktive Planning-API-Tokens sind erlaubt.", 409);
    if (error.code === "P0002") return apiError("Operatives Profil wurde nicht gefunden.", 403);
    if (error.code === "P0006") return apiError("Nur CEO oder Deputy können den Delete-Scope erhalten.", 403);
    if (error.code === "22023") return apiError("Token-Daten sind ungültig.", 400);
    return apiError(error.code === "PGRST202" || error.code === "42883" ? "Planning-API-Schema ist noch nicht verfügbar." : "Planning-API-Token konnte nicht erstellt werden.", error.code === "PGRST202" || error.code === "42883" ? 503 : 500);
  }

  return NextResponse.json({
    ok: true,
    token: data?.token,
    tokenRecord: data?.tokenRecord,
  });
}
