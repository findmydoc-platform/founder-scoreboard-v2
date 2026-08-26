import "server-only";

import {
  requireTeamWorkweekStarterAccess,
  TeamWorkweekRolloutError,
} from "./team-workweek-rollout";
import { apiError } from "@/lib/api-response";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import type { PlatformRole } from "@/lib/types";

export async function requireTeamWorkweekStarterApiAccess({
  actorProfileId,
  actorRole,
}: {
  actorProfileId: string;
  actorRole: PlatformRole | null | undefined;
}) {
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) {
    return { ok: false as const, response: apiError("Team-Arbeitswoche ist nicht verfügbar.", 503) };
  }
  try {
    await requireTeamWorkweekStarterAccess({ actorProfileId, actorRole, serviceSupabase });
    return { ok: true as const, serviceSupabase };
  } catch (error) {
    if (!(error instanceof TeamWorkweekRolloutError)) {
      return { ok: false as const, response: apiError("Team-Arbeitswoche ist nicht verfügbar.", 503) };
    }
    const status = error.code === "forbidden" ? 403 : 503;
    return { ok: false as const, response: apiError(error.message, status) };
  }
}
