import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanOptionalDate, cleanOptionalText } from "@/lib/api-input";
import { apiError, authzError } from "@/lib/api-response";
import { bearerToken, requireCEO } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";
import type { PlatformRole } from "@/lib/types";

type GovernancePayload = {
  platformRole?: unknown;
  orgRole?: unknown;
  deputyFor?: unknown;
  deputyActiveFrom?: unknown;
  deputyActiveUntil?: unknown;
  weeklyCapacity?: unknown;
};

type GovernanceProfileRow = {
  id: string;
  name: string;
  platform_role: PlatformRole;
  org_role: string | null;
  deputy_for: string | null;
  deputy_active_from: string | null;
  deputy_active_until: string | null;
  weekly_capacity: number;
};

const platformRoles = new Set<PlatformRole>(["ceo", "founder", "deputy", "viewer"]);

function governanceRoleLabel(role: PlatformRole) {
  if (role === "ceo") return "CEO";
  if (role === "deputy") return "Deputy";
  if (role === "viewer") return "Viewer";
  return "Founder";
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const permission = await requireCEO(request);
  if (!permission.ok) return authzError(permission);
  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);
  const payload = await request.json().catch(() => null) as GovernancePayload | null;
  if (!payload) return apiError("Profiländerung fehlt.", 400);
  const patch: Record<string, string | number | null> = {};

  if (payload.platformRole !== undefined) {
    if (typeof payload.platformRole !== "string" || !platformRoles.has(payload.platformRole as PlatformRole)) {
      return apiError("Ungültige Plattformrolle.", 400);
    }
    patch.platform_role = payload.platformRole;
  }
  if (payload.orgRole !== undefined) patch.org_role = cleanOptionalText(payload.orgRole, 80) || null;
  if (payload.deputyFor !== undefined) patch.deputy_for = cleanOptionalText(payload.deputyFor, 80) || null;
  if (payload.deputyActiveFrom !== undefined) {
    const value = cleanOptionalDate(payload.deputyActiveFrom);
    if (value === undefined) return apiError("Ungültiges Startdatum.", 400);
    patch.deputy_active_from = value;
  }
  if (payload.deputyActiveUntil !== undefined) {
    const value = cleanOptionalDate(payload.deputyActiveUntil);
    if (value === undefined) return apiError("Ungültiges Enddatum.", 400);
    patch.deputy_active_until = value;
  }
  if (payload.weeklyCapacity !== undefined) {
    const capacity = Number(payload.weeklyCapacity);
    if (!Number.isFinite(capacity) || capacity < 0 || capacity > 80) {
      return apiError("Kapazität muss zwischen 0 und 80 Stunden liegen.", 400);
    }
    patch.weekly_capacity = Math.round(capacity);
  }
  if (patch.platform_role && patch.platform_role !== "deputy") {
    patch.deputy_for = null;
    patch.deputy_active_from = null;
    patch.deputy_active_until = null;
  }

  const { id } = await context.params;
  const metadata = auditRequestMetadata(request);
  const { data, error } = await supabase.rpc("update_profile_governance_transaction", {
    p_profile_id: id,
    p_profile_patch: patch,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent,
  });
  if (error?.code === "P0002") return apiError("Profil wurde nicht gefunden.", 404);
  if (error?.code === "23514") return apiError("Genau ein CEO muss gesetzt bleiben.", 409);
  if (error?.code === "22023") return apiError("Profiländerung ist ungültig.", 400);
  if (error?.code === "42501") return apiError("Nur der CEO kann fachliche Rollen verwalten.", 403);
  if (error) return apiError("Profil konnte nicht gespeichert werden.", 500);
  if (!data?.profile) return apiError("Profil konnte nicht gespeichert werden.", 500);
  const profile = data.profile as GovernanceProfileRow;
  return NextResponse.json({
    profile: {
      id: profile.id,
      name: profile.name,
      platformRole: profile.platform_role,
      orgRole: profile.org_role || governanceRoleLabel(profile.platform_role),
      deputyFor: profile.deputy_for || "",
      deputyActiveFrom: profile.deputy_active_from || "",
      deputyActiveUntil: profile.deputy_active_until || "",
      weeklyCapacity: profile.weekly_capacity,
    },
    notificationPreferences: [],
  });
}
