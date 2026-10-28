import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanOptionalText } from "@/lib/api-input";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";
import { isGitHubLogin } from "@/lib/mentions";

type TechnicalIdentityPayload = {
  expected?: unknown;
  githubLogin?: unknown;
  googleChatUserId?: unknown;
  googleChatDmSpace?: unknown;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "administration.technical.update", targetProfileId: id });
  if (!permission.ok) return authzError(permission);
  const payload = await request.json().catch(() => null) as TechnicalIdentityPayload | null;
  if (!payload) return apiError("Technische Identität fehlt.", 400);
  if (Object.keys(payload).some((key) => !["githubLogin", "googleChatUserId", "googleChatDmSpace", "expected"].includes(key))) {
    return apiError("Technische Identität enthält ein nicht unterstütztes Feld.", 400);
  }

  const expected = payload.expected as import("@/features/administration/model/administration-read-model").TechnicalIdentityBasis | undefined;
  if (expected !== undefined && (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).length !== 3 || (["githubLogin", "googleChatUserId", "googleChatDmSpace"] as const).some(field => !(field in expected) || expected[field] !== null && typeof expected[field] !== "string"))) return apiError("Die ursprüngliche technische Basis ist ungültig.", 400);
  const githubLogin = payload.githubLogin === undefined ? undefined : cleanOptionalText(payload.githubLogin, 80);
  if (githubLogin && !isGitHubLogin(githubLogin)) return apiError("GitHub-Login ist ungültig.", 400);
  const patch = {
    ...(githubLogin !== undefined ? { github_login: githubLogin } : {}),
    ...(payload.googleChatUserId !== undefined ? { google_chat_user_id: cleanOptionalText(payload.googleChatUserId, 160) } : {}),
    ...(payload.googleChatDmSpace !== undefined ? { google_chat_dm_space: cleanOptionalText(payload.googleChatDmSpace, 240) } : {}),
  };
  const metadata = auditRequestMetadata(request);
  const { data, error } = await permission.administrator.updateTechnicalIdentity(patch, { requestIp: metadata.request_ip, userAgent: metadata.user_agent }, expected);
  if (error?.code === "42501") {
    return authzError(await permission.administrator.failure());
  }
  if (error?.code === "P0019") return NextResponse.json({ error: "Die technische Identität wurde zwischenzeitlich geändert. Bitte vergleichen.", code: "administration_technical_conflict" }, { status: 409 });
  if (error?.code === "P0002") return apiError("Profil wurde nicht gefunden.", 404);
  if (error?.code === "22023") return apiError("Technische Identität ist ungültig.", 400);
  if (error) return apiError("Technische Identität konnte nicht gespeichert werden.", 500);
  const saved = (data as { profile?: Record<string, unknown> } | null)?.profile;
  const hasReceipt = saved?.id === id && ["github_login", "google_chat_user_id", "google_chat_dm_space"].every(field => field in saved && (saved[field] === null || typeof saved[field] === "string"));
  return NextResponse.json({ ok: true, ...(hasReceipt ? { profile: { id, githubLogin: saved!.github_login, googleChatUserId: saved!.google_chat_user_id, googleChatDmSpace: saved!.google_chat_dm_space } } : {}) });
}
