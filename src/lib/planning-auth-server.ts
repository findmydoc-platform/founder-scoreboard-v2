import type { User } from "@supabase/supabase-js";
import { requirePlatformRoleForUser } from "./authz";
import { getServerAuthSupabase } from "./supabase-server";
import type { AuthenticatedProfile, PlatformRole } from "./types";

export type ServerPlanningAuth =
  | { ok: true; user: User; profile: AuthenticatedProfile | null }
  | { ok: false; status: number; error: string; user: User | null };

export async function getServerPlanningAuth(allowedRoles: PlatformRole[]): Promise<ServerPlanningAuth> {
  const supabase = await getServerAuthSupabase();
  if (!supabase) return { ok: false, status: 401, error: "Anmeldung erforderlich.", user: null };

  const { data: userResult, error: userError } = await supabase.auth.getUser();
  if (userError || !userResult.user) {
    return { ok: false, status: 401, error: "Anmeldung ungültig oder abgelaufen.", user: null };
  }

  const authz = await requirePlatformRoleForUser(supabase, userResult.user, allowedRoles);
  if (!authz.ok) return { ...authz, user: userResult.user };

  return { ok: true, user: userResult.user, profile: authz.profile };
}
