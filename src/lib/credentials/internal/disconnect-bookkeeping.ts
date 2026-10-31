import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoogleWorkspaceDisconnectError, type DisconnectBookkeeping, type DisconnectOperationRow } from "@/features/team-workweek/server/google-workspace-disconnect";

import { workweekBookkeeping } from "./planning-workweek-bookkeeping";

const denied = () => ({ data: null, error: { code: "42501", message: "Keine gebundene Trennungsoperation vorhanden." } });
export function disconnectBookkeeping(guarded: SupabaseClient, followup: SupabaseClient, ownerProfileId: string): DisconnectBookkeeping {
  const workweek = workweekBookkeeping({ guarded, followup, ownerProfileId });
  return {
    forCompensation(publicationId, generation) {
      return {
        publication: workweek.forPublication({ id: publicationId, ownerProfileId, attemptGeneration: generation, publicationRevision: 0, writeJournalVersion: 1, effects: [] }),
        async retire() { return followup.rpc("retire_compensated_workweek_for_disconnect", { p_owner_profile_id: ownerProfileId, p_publication_id: publicationId, p_generation: generation }); },
      };
    },
    forOperation(suppliedOperation, suppliedTargets) {
    const operation = structuredClone(suppliedOperation);
    const targets = new Map(suppliedTargets.map(target => [target.id, structuredClone(target)]));
    const bound = operation.owner_profile_id === ownerProfileId && operation.state !== "completed";
    const confirmed = new Set(suppliedTargets.filter(target => target.state === "confirmed").map(target => target.id));
    let finalized = false, removed = false;
    return {
      async delay(targetId, errorClass, observedAt) {
        if (!bound || !targets.has(targetId)) throw new Error("Keine gebundene Trennungsoperation vorhanden.");
        const results = await Promise.all([
          followup.from("google_workspace_disconnect_series").update({ last_error_class: errorClass, last_observed_at: observedAt, updated_at: observedAt }).eq("id", targetId).eq("operation_id", operation.id).eq("state", "pending"),
          followup.from("google_workspace_disconnect_operations").update({ last_error_class: errorClass, updated_at: observedAt }).eq("id", operation.id).eq("owner_profile_id", ownerProfileId),
        ]);
        if (results.some(result => result.error)) throw new GoogleWorkspaceDisconnectError("unavailable", "Verzögerte Kalenderbereinigung konnte nicht gespeichert werden.");
      },
      async recordWrite(targetId, state) {
        if (!bound || !targets.has(targetId)) return denied();
        return followup.rpc("record_google_workspace_disconnect_write", {p_target_id: targetId, p_state: state});
      },
      async confirm(targetId, expectedEtag, confirmedEtag, observedAt) {
        if (!bound || targets.get(targetId)?.expected_etag !== expectedEtag) return denied();
        const result = await followup.rpc("confirm_google_workspace_disconnect_series", { p_target_id: targetId, p_expected_etag: expectedEtag, p_confirmed_etag: confirmedEtag, p_observed_at: observedAt });
        if (!result.error) confirmed.add(targetId);
        return result;
      },
      async finalize(observedAt) {
        if (!bound || confirmed.size !== targets.size) return denied();
        const result = await followup.rpc("finalize_google_workspace_disconnect", { p_operation_id: operation.id, p_owner_profile_id: ownerProfileId, p_observed_at: observedAt });
        if (!result.error) finalized = true;
        return result;
      },
      async readFinalized() {
        if (!bound || !finalized) return null;
        const result = await followup.from("google_workspace_disconnect_operations").select("id,owner_profile_id,requested_by,revoke_connection,state,retained_version_id,deactivated_at,completed_at,last_error_class")
          .eq("id", operation.id).eq("owner_profile_id", ownerProfileId).maybeSingle<DisconnectOperationRow>();
        if (result.error) throw new GoogleWorkspaceDisconnectError("unavailable", "Trennungsstatus ist nicht verfügbar.");
        return result.data;
      },
      connectionRemoved() { if (bound && (finalized || operation.state === "revoke_pending")) removed = true; },
      async complete(completedAt) {
        if (!bound || !removed) return denied();
        return followup.rpc("complete_google_workspace_disconnect", { p_operation_id: operation.id, p_owner_profile_id: ownerProfileId, p_completed_at: completedAt });
      },
    };
  } };
}
