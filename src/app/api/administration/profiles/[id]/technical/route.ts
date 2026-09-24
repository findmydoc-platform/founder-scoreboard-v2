import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanOptionalText } from "@/lib/api-input";
import { apiError, authzError } from "@/lib/api-response";
import { bearerToken, requireActiveAdministrator, resolveAdministratorAccessFailure } from "@/lib/authz";
import { isGitHubLogin } from "@/lib/mentions";
import { getSupabaseForToken } from "@/lib/supabase";

type TechnicalIdentityPayload = {
  githubLogin?: unknown;
  googleChatUserId?: unknown;
  googleChatDmSpace?: unknown;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const permission = await requireActiveAdministrator(request);
  if (!permission.ok) return authzError(permission);
  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);
  const payload = await request.json().catch(() => null) as TechnicalIdentityPayload | null;
  if (!payload) return apiError("Technische Identität fehlt.", 400);
  if (Object.keys(payload).some((key) => !["githubLogin", "googleChatUserId", "googleChatDmSpace"].includes(key))) {
    return apiError("Technische Identität enthält ein nicht unterstütztes Feld.", 400);
  }

  const githubLogin = payload.githubLogin === undefined ? undefined : cleanOptionalText(payload.githubLogin, 80);
  if (githubLogin && !isGitHubLogin(githubLogin)) return apiError("GitHub-Login ist ungültig.", 400);
  const patch = {
    ...(githubLogin !== undefined ? { github_login: githubLogin } : {}),
    ...(payload.googleChatUserId !== undefined ? { google_chat_user_id: cleanOptionalText(payload.googleChatUserId, 160) } : {}),
    ...(payload.googleChatDmSpace !== undefined ? { google_chat_dm_space: cleanOptionalText(payload.googleChatDmSpace, 240) } : {}),
  };
  const { id } = await context.params;
  const metadata = auditRequestMetadata(request);
  const { error } = await supabase.rpc("update_profile_technical_identity_transaction", {
    p_profile_id: id,
    p_profile_patch: patch,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent,
  });
  if (error?.code === "42501") {
    return authzError(await resolveAdministratorAccessFailure(supabase));
  }
  if (error?.code === "P0002") return apiError("Profil wurde nicht gefunden.", 404);
  if (error?.code === "22023") return apiError("Technische Identität ist ungültig.", 400);
  if (error) return apiError("Technische Identität konnte nicht gespeichert werden.", 500);
  return NextResponse.json({ ok: true });
}
