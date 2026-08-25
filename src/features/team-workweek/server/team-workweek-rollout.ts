import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isStarterPlatformRole,
  isTeamWorkweekStarterEnabled as isStarterEnabledValue,
  TEAM_WORKWEEK_STARTER_ENV,
  TEAM_WORKWEEK_STARTER_SIZE,
} from "../model/team-workweek-rollout";
import type { PlatformRole } from "@/lib/types";

export { TEAM_WORKWEEK_STARTER_ENV, TEAM_WORKWEEK_STARTER_SIZE };

type RolloutErrorCode = "disabled" | "forbidden" | "configuration" | "unavailable";

export class TeamWorkweekRolloutError extends Error {
  constructor(readonly code: RolloutErrorCode, message: string) {
    super(message);
    this.name = "TeamWorkweekRolloutError";
  }
}

export function isTeamWorkweekStarterEnabled(value = process.env[TEAM_WORKWEEK_STARTER_ENV]) {
  return isStarterEnabledValue(value);
}

export async function loadStarterProfileIds(serviceSupabase: SupabaseClient) {
  const response = await serviceSupabase
    .from("profiles")
    .select("id,platform_role")
    .in("platform_role", ["ceo", "founder"])
    .order("id", { ascending: true })
    .returns<Array<{ id: string; platform_role: PlatformRole }>>();
  if (response.error) {
    throw new TeamWorkweekRolloutError("unavailable", "Starter-Profile konnten nicht geprüft werden.");
  }
  return (response.data || []).map((profile) => profile.id);
}

export function requireExactStarter(profileIds: string[]) {
  if (profileIds.length !== TEAM_WORKWEEK_STARTER_SIZE) {
    throw new TeamWorkweekRolloutError(
      "configuration",
      `Der Starter erfordert genau ${TEAM_WORKWEEK_STARTER_SIZE} freigegebene CEO-/Founder-Profile.`,
    );
  }
}

export async function requireTeamWorkweekStarterAccess({
  actorProfileId,
  actorRole,
  serviceSupabase,
}: {
  actorProfileId: string;
  actorRole: PlatformRole | null | undefined;
  serviceSupabase: SupabaseClient;
}) {
  if (!isTeamWorkweekStarterEnabled()) {
    throw new TeamWorkweekRolloutError("disabled", "Team-Arbeitswoche ist nicht freigeschaltet.");
  }
  if (!actorProfileId || !isStarterPlatformRole(actorRole)) {
    throw new TeamWorkweekRolloutError("forbidden", "Dieses Profil gehört nicht zum freigegebenen Starter.");
  }
  const profileIds = await loadStarterProfileIds(serviceSupabase);
  requireExactStarter(profileIds);
  if (!profileIds.includes(actorProfileId)) {
    throw new TeamWorkweekRolloutError("forbidden", "Dieses Profil gehört nicht zum freigegebenen Starter.");
  }
  return profileIds;
}
