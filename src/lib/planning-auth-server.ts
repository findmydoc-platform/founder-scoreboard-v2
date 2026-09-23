import type { SupabaseClient, User } from "@supabase/supabase-js";
import { rootWorkspaceFromPreference, type AppWorkspace } from "@/features/planning/model/workspace-routes";
import { loadSessionAuthority, requireTeamMemberForSession } from "./authz";
import { getServerAuthSupabase } from "./supabase-server";
import type { AuthenticatedProfile } from "./types";
import type { SessionAuthorityContext } from "@/features/administrator-access/model/administrator-access";

export type ServerPlanningAuth =
  | { ok: true; user: User; profile: AuthenticatedProfile | null; authority: SessionAuthorityContext | null }
  | { ok: false; status: number; error: string; user: User | null };

type ServerPlanningAuthContext =
  | { ok: true; user: User; profile: AuthenticatedProfile | null; supabase: SupabaseClient }
  | Extract<ServerPlanningAuth, { ok: false }>;

type ProfileUiPreferenceRow = {
  default_workspace: string;
};

async function getServerPlanningAuthContext(): Promise<ServerPlanningAuthContext> {
  const supabase = await getServerAuthSupabase();
  if (!supabase) return { ok: false, status: 401, error: "Anmeldung erforderlich.", user: null };

  const authz = await requireTeamMemberForSession(supabase);
  if (!authz.ok) return authz;

  return { ...authz, supabase };
}

export async function getServerPlanningAuth(): Promise<ServerPlanningAuth> {
  const auth = await getServerPlanningAuthContext();
  if (!auth.ok) return auth;
  const authority = auth.profile ? await loadSessionAuthority(auth.supabase, auth.profile) : null;
  return { ok: true, user: auth.user, profile: auth.profile, authority };
}

export async function getServerPlanningHomeWorkspace(): Promise<AppWorkspace> {
  const auth = await getServerPlanningAuthContext();
  if (!auth.ok || !auth.profile) return "planning";

  const { data, error } = await auth.supabase
    .from("profile_ui_preferences")
    .select("default_workspace")
    .eq("profile_id", auth.profile.id)
    .maybeSingle<ProfileUiPreferenceRow>();

  if (error) return "planning";
  return rootWorkspaceFromPreference(data?.default_workspace);
}
