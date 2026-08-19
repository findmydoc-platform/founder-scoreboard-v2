import { NextResponse, type NextRequest } from "next/server";
import {
  TEAM_PLANNING_ITEM_SCOPES,
  type TeamPlanningItemScope,
} from "@/features/planning-items/model/planning-items-contract";
import {
  requireTeamPlanningItemScope,
  type TeamPlanningItemsAuthResult,
} from "@/features/planning-items/model/planning-items-token";

export type PlanningItemsOperation =
  | "planningContext.read"
  | "planningItems.create"
  | "planningItems.update"
  | "planningItems.deleteEmpty"
  | "planningItems.githubSync";

export type PlanningItemsRequestMode = "read" | "preview" | "commit";

export type PlanningItemsAccessRequest = Readonly<{
  operation: PlanningItemsOperation;
  mode: PlanningItemsRequestMode;
  requiredScopes: readonly TeamPlanningItemScope[];
  resolveAdditionalScopes?: (
    permission: SuccessfulPlanningItemsAuth,
  ) => Promise<readonly TeamPlanningItemScope[]>;
}>;

type SuccessfulPlanningItemsAuth = Extract<TeamPlanningItemsAuthResult, { ok: true }>;
type PlanningItemsHandler = (permission: SuccessfulPlanningItemsAuth) => Promise<Response>;
type PlanningItemsErrorOptions = Readonly<{
  code?: string;
  headers?: HeadersInit;
}>;

type PlanningItemsAccessMetadata = Readonly<{
  operation: PlanningItemsOperation;
  mode: PlanningItemsRequestMode;
  access: Readonly<{
    evaluatedAt: string;
    decision: "allowed" | "denied";
    token: Readonly<{
      hint: string;
      grantedScopes: readonly TeamPlanningItemScope[];
      expiresAt: string;
      remainingSeconds: number;
    }>;
    requiredScopes: readonly TeamPlanningItemScope[];
    missingScopes: readonly TeamPlanningItemScope[];
  }>;
}>;

function canonicalScopes(scopes: readonly TeamPlanningItemScope[]) {
  const requested = new Set(scopes);
  return TEAM_PLANNING_ITEM_SCOPES.filter((scope) => requested.has(scope));
}

function responseHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("Cache-Control", "no-store");
  return result;
}

export function planningItemsJson(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: responseHeaders(headers),
  });
}

export function planningItemsError(
  error: string,
  status: number,
  options: PlanningItemsErrorOptions = {},
) {
  return planningItemsJson({
    ok: false,
    ...(options.code ? { code: options.code } : {}),
    error,
  }, status, options.headers);
}

export function planningItemsTokenInactiveError() {
  return planningItemsError("Planning-API-Token ist nicht mehr aktiv.", 401, {
    code: "TOKEN_INACTIVE",
    headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' },
  });
}

function publicCommitError(error: unknown, fallbackError: string) {
  const code = error instanceof Error && "code" in error ? String(error.code || "") : "";
  if (code === "P0001") return planningItemsError("Planungselement wurde zwischenzeitlich geändert. Bitte erneut laden.", 409);
  if (code === "P0002") return planningItemsError("Planungselement wurde nicht gefunden.", 404);
  if (code === "P0003") return planningItemsError("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
  if (["P0008", "P0010"].includes(code)) return planningItemsError("Statusübergang ist wegen eines zwischenzeitlich geänderten Planungs- oder Review-Zustands nicht mehr zulässig.", 409);
  if (code === "P0004") {
    return planningItemsTokenInactiveError();
  }
  if (["P0005", "P0006", "P0007"].includes(code)) {
    return planningItemsError("Planning-API-Berechtigung ist nicht mehr gültig.", 403, {
      code: "TOKEN_PROFILE_FORBIDDEN",
    });
  }
  if (code === "22023") return planningItemsError("Planning-Items-Anfrage ist ungültig.", 400);
  if (["PGRST202", "42P01", "42703", "42883"].includes(code)) {
    return planningItemsError("Planning-API-Schema ist noch nicht verfügbar.", 503);
  }
  return planningItemsError(fallbackError, 500);
}

function accessMetadata(
  permission: SuccessfulPlanningItemsAuth,
  request: PlanningItemsAccessRequest,
  requiredScopes: readonly TeamPlanningItemScope[],
  missingScopes: readonly TeamPlanningItemScope[],
): PlanningItemsAccessMetadata {
  return {
    operation: request.operation,
    mode: request.mode,
    access: {
      evaluatedAt: permission.evaluatedAt,
      decision: missingScopes.length ? "denied" : "allowed",
      token: {
        hint: permission.tokenHint,
        grantedScopes: canonicalScopes(permission.scopes),
        expiresAt: permission.expiresAt,
        remainingSeconds: permission.remainingSeconds,
      },
      requiredScopes,
      missingScopes,
    },
  };
}

function insufficientScopeResponse(
  permission: SuccessfulPlanningItemsAuth,
  request: PlanningItemsAccessRequest,
  requiredScopes: readonly TeamPlanningItemScope[],
  missingScopes: readonly TeamPlanningItemScope[],
) {
  return planningItemsJson({
    ok: false,
    code: "INSUFFICIENT_SCOPE",
    error: scopeErrorMessage(request.mode, missingScopes),
    _meta: accessMetadata(permission, request, requiredScopes, missingScopes),
  }, 403, {
    "WWW-Authenticate": 'Bearer error="insufficient_scope"',
  });
}

function scopeErrorMessage(
  mode: PlanningItemsRequestMode,
  missingScopes: readonly TeamPlanningItemScope[],
) {
  const action = mode === "preview"
    ? "Preview wurde nicht ausgeführt"
    : mode === "commit"
      ? "Änderung wurde nicht ausgeführt"
      : "Anfrage wurde nicht ausgeführt";
  const permission = missingScopes.length === 1
    ? `Dem Token fehlt ${missingScopes[0]}.`
    : `Dem Token fehlen ${missingScopes.join(", ")}.`;
  return `${action}: ${permission}`;
}

function accessWasInvalidated(body: Record<string, unknown>, status: number) {
  if (status === 401) return true;
  if (["TOKEN_INACTIVE", "TOKEN_PROFILE_FORBIDDEN"].includes(String(body.code || ""))) {
    return true;
  }
  return false;
}

async function addAccessMetadata(
  response: Response,
  metadata: PlanningItemsAccessMetadata,
) {
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return response;
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return response;
  if (accessWasInvalidated(body as Record<string, unknown>, response.status)) {
    return planningItemsJson(body, response.status, response.headers);
  }
  return planningItemsJson({
    ...(body as Record<string, unknown>),
    _meta: metadata,
  }, response.status, response.headers);
}

function bearerChallenge(code: string) {
  if (code === "TOKEN_REQUIRED") return "Bearer";
  if (code === "TOKEN_INACTIVE") return 'Bearer error="invalid_token"';
  return "";
}

export async function handlePlanningItemsRequest(
  request: NextRequest,
  accessRequest: PlanningItemsAccessRequest,
  fallbackError: string,
  handler: PlanningItemsHandler,
) {
  const requiredScopes = canonicalScopes(accessRequest.requiredScopes);
  const primaryScope = requiredScopes[0];
  if (!primaryScope || requiredScopes.length !== new Set(accessRequest.requiredScopes).size) {
    return planningItemsError("Planning-API-Berechtigung konnte nicht geprüft werden.", 500, {
      code: "AUTHORIZATION_UNAVAILABLE",
    });
  }

  const permission = await requireTeamPlanningItemScope(request, primaryScope);
  if (!permission.ok) {
    const challenge = bearerChallenge(permission.code);
    return planningItemsError(permission.error, permission.status, {
      code: permission.code,
      ...(challenge ? { headers: { "WWW-Authenticate": challenge } } : {}),
    });
  }

  if (permission.scopeGranted !== permission.scopes.includes(primaryScope)) {
    return planningItemsError("Planning-API-Berechtigung konnte nicht geprüft werden.", 500, {
      code: "AUTHORIZATION_UNAVAILABLE",
    });
  }

  const missingBaseScopes = requiredScopes.filter((scope) => !permission.scopes.includes(scope));
  if (missingBaseScopes.length) {
    return insufficientScopeResponse(
      permission,
      accessRequest,
      requiredScopes,
      missingBaseScopes,
    );
  }

  let allRequiredScopes = requiredScopes;
  if (accessRequest.resolveAdditionalScopes) {
    try {
      const additionalScopes = await accessRequest.resolveAdditionalScopes(permission);
      allRequiredScopes = canonicalScopes([...requiredScopes, ...additionalScopes]);
      if (allRequiredScopes.length !== new Set([...requiredScopes, ...additionalScopes]).size) {
        const metadata = accessMetadata(permission, accessRequest, requiredScopes, []);
        return addAccessMetadata(planningItemsError(
          "Planning-API-Berechtigung konnte nicht geprüft werden.",
          500,
          { code: "AUTHORIZATION_UNAVAILABLE" },
        ), metadata);
      }
    } catch (error) {
      const metadata = accessMetadata(permission, accessRequest, requiredScopes, []);
      return addAccessMetadata(publicCommitError(error, fallbackError), metadata);
    }
  }

  const missingScopes = allRequiredScopes.filter((scope) => !permission.scopes.includes(scope));
  if (missingScopes.length) {
    return insufficientScopeResponse(
      permission,
      accessRequest,
      allRequiredScopes,
      missingScopes,
    );
  }
  const metadata = accessMetadata(permission, accessRequest, allRequiredScopes, []);

  try {
    return await addAccessMetadata(await handler(permission), metadata);
  } catch (error) {
    return addAccessMetadata(publicCommitError(error, fallbackError), metadata);
  }
}
