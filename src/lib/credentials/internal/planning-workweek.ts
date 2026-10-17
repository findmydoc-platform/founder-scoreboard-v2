import "server-only";
import { workweekBookkeeping } from "./planning-workweek-bookkeeping";
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthenticatedProfile } from "../../types";
import type { PlanningCredentialInput } from "../types";
import { delayTeamWorkweekPublication, publishTeamWorkweek, TeamWorkweekPublicationError } from "@/features/team-workweek/server/team-workweek-publication";
import { detectTeamWorkweekParallelConflict, getOpenTeamWorkweekConflict, resolveTeamWorkweekConflict, TeamWorkweekConflictError } from "@/features/team-workweek/server/team-workweek-conflicts";
import { restartPrivateTeamWorkweek } from "@/features/team-workweek/server/team-workweek-restart";
import { reconcileTeamWorkweek, TeamWorkweekReconciliationError } from "@/features/team-workweek/server/team-workweek-reconciliation";

type Context = { action: PlanningCredentialInput["action"]; targetId: string; profile: AuthenticatedProfile | null; service: SupabaseClient; followup: SupabaseClient;
  data: SupabaseClient | null; request: NextRequest; current(): Promise<{ code?: string; message: string } | null> };
export function planningWorkweekOperations({ action, targetId, profile, service, followup, data, request, current }: Context) {
  const bookkeeping = workweekBookkeeping({ guarded: service, followup, ownerProfileId: profile?.id || "" });
  let clearPreflight = false;
  let delayClass: Parameters<typeof delayTeamWorkweekPublication>[0]["errorClass"] | null = null;
  return {
    async detectWorkweekConflict() {
      if (action !== "workweek.publish" || !targetId || !profile || !data || await current()) throw new TeamWorkweekConflictError("forbidden", "Keine Berechtigung für diese Aktion.");
      try {
        const result = await detectTeamWorkweekParallelConflict({ request, serviceSupabase: service, ownerProfileId: profile.id, versionId: targetId });
        clearPreflight = result.state === "clear";
        return result;
      } catch (error) {
        if (error instanceof TeamWorkweekConflictError && error.delayClass) delayClass = error.delayClass;
        throw error;
      }
    },
    async publishWorkweek() {
      if (action !== "workweek.publish" || !clearPreflight || !targetId || !profile || !data || await current()) throw new TeamWorkweekPublicationError("forbidden", "Keine Berechtigung für diese Aktion.");
      return publishTeamWorkweek({ request, bookkeeping, serviceSupabase: service, userSupabase: data, versionId: targetId });
    },
    async delayWorkweek() {
      if (action !== "workweek.publish" || !delayClass || !targetId || !profile || !data || await current()) throw new TeamWorkweekPublicationError("forbidden", "Keine Berechtigung für diese Aktion.");
      return delayTeamWorkweekPublication({ bookkeeping, serviceSupabase: service, userSupabase: data, versionId: targetId, errorClass: delayClass });
    },
    async restartWorkweek() {
      if (action !== "workweek.restart" || !targetId || !profile || !data || await current()) throw new TeamWorkweekPublicationError("forbidden", "Keine Berechtigung für diese Aktion.");
      return restartPrivateTeamWorkweek({ request, bookkeeping, serviceSupabase: service, userSupabase: data, ownerProfileId: profile.id, versionId: targetId });
    },
    async readWorkweekConflict() {
      if (action !== "workweek.conflict.read" || !profile || !data || await current()) throw new TeamWorkweekConflictError("forbidden", "Keine Berechtigung für diese Aktion.");
      return getOpenTeamWorkweekConflict(service, profile.id);
    },
    async resolveWorkweekConflict(conflictRevision: number, decision: "founderops" | "google") {
      if (action !== "workweek.conflict.resolve" || !targetId || !profile || !data || await current()) throw new TeamWorkweekConflictError("forbidden", "Keine Berechtigung für diese Aktion.");
      return resolveTeamWorkweekConflict({ request, bookkeeping: workweekBookkeeping({ guarded: service, followup, ownerProfileId: profile.id, conflictId: targetId, conflictRevision }), serviceSupabase: service, userSupabase: data, ownerProfileId: profile.id, conflictId: targetId, conflictRevision, decision });
    },
    async reconcileWorkweek() {
      if (action !== "workweek.reconcile" || !profile || !data || await current()) throw new TeamWorkweekReconciliationError("forbidden", "Keine Berechtigung für diese Aktion.");
      return reconcileTeamWorkweek({ request, bookkeeping, serviceSupabase: service, userSupabase: data, ownerProfileId: profile.id });
    },
  };
}
