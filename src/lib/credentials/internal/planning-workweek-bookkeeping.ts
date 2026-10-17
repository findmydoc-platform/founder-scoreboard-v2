import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkweekBookkeeping } from "@/features/team-workweek/server/team-workweek-bookkeeping";

const denied = async () => ({ data: null, error: { code: "42501", message: "Keine gebundene Grundwochen-Operation vorhanden." }, count: null, status: 403, statusText: "Forbidden" });
export function workweekBookkeeping({ guarded, followup, ownerProfileId, conflictId, conflictRevision }: {
  guarded: SupabaseClient; followup: SupabaseClient; ownerProfileId: string; conflictId?: string; conflictRevision?: number;
}): WorkweekBookkeeping {
  const accepted = new Set<string>(), published = new Set<string>();
  return {
    forPublication(value) {
      const publication = structuredClone(value);
      const bound = publication.ownerProfileId === ownerProfileId;
      if (bound) accepted.add(publication.id);
      const operations = new Set<string>();
      const effects = new Map((publication.effects || []).map(effect => [effect.id, structuredClone(effect)]));
      const series = new Set(publication.series.map(row => row.id));
      const transitions = new Map(publication.transitions.map(row => [row.id, row.expectedFounderopsRevision]));
      return {
        async claim(purpose) {
          if (!bound || !publication.attemptGeneration) return denied();
          const result = await guarded.rpc("claim_team_workweek_provider_operation", { p_publication_id: publication.id, p_generation: publication.attemptGeneration, p_purpose: purpose });
          if (!result.error && ["claimed", "uncertain"].includes(result.data?.state) && typeof result.data.id === "string") operations.add(result.data.id);
          return result;
        },
        async recordWrite(operationId, effectId, state) {
          if (!bound || !operations.has(operationId) || !effects.has(effectId)) return denied();
          return await followup.rpc("record_team_workweek_provider_write", { p_operation_id: operationId, p_effect_id: effectId, p_state: state });
        },
        async finish(operationId) {
          if (!bound || !operations.has(operationId)) return denied();
          return await followup.rpc("finish_team_workweek_provider_operation", { p_operation_id: operationId });
        },
        async confirmEffect(effectId, generation, etag) {
          if (!bound || (publication.writeJournalVersion !== undefined && !operations.size) || effects.get(effectId)?.generation !== generation) return denied();
          return await followup.rpc("confirm_team_workweek_effect", { p_effect_id: effectId, p_generation: generation, p_etag: etag, p_payload: effects.get(effectId)!.payload });
        },
        async confirmSeries(seriesId, etag, observedAt) {
          if (!bound || !series.has(seriesId)) return denied();
          return await followup.rpc("confirm_team_workweek_google_series", { p_series_id: seriesId, p_etag: etag, p_founderops_revision: publication.publicationRevision, p_observed_at: observedAt });
        },
        async confirmTransition(transitionId, etag, expectedRevision, observedAt) {
          if (!bound || transitions.get(transitionId) !== expectedRevision) return denied();
          return await followup.rpc("confirm_team_workweek_google_series_transition", { p_transition_id: transitionId, p_etag: etag, p_expected_founderops_revision: expectedRevision, p_observed_at: observedAt });
        },
        preparedEffects(rows) {
          if (!bound) return;
          for (const effect of rows) effects.set(effect.id, structuredClone(effect));
        },
        async confirmCleanup(effectId, generation, etag, preserved) {
          if (!bound || (publication.writeJournalVersion !== undefined && !operations.size) || effects.get(effectId)?.generation !== generation) return denied();
          return await followup.rpc("confirm_team_workweek_planned_cleanup", { p_effect_id: effectId, p_generation: generation, p_etag: etag, p_preserved: preserved });
        },
        async delay(errorClass, observedAt) {
          if (!bound) return denied();
          return await followup.rpc("delay_team_workweek_publication", { p_publication_id: publication.id, p_error_class: errorClass, p_observed_at: observedAt });
        },
      };
    },
    published(publication) { if (publication.status === "published" && accepted.has(publication.id)) published.add(publication.id); },
    async completeConflict(values) {
      if (!conflictId || values.conflictId !== conflictId || values.ownerProfileId !== ownerProfileId || values.revision !== conflictRevision || !published.has(values.publicationId)) return denied();
      return await followup.rpc("complete_team_workweek_google_conflict_resolution", { p_conflict_id: conflictId, p_owner_profile_id: ownerProfileId, p_conflict_revision: conflictRevision, p_resolved_at: values.resolvedAt });
    },
    async recordReconciliation(values) {
      if (!published.has(values.publicationId)) return denied();
      return await followup.rpc("record_google_team_workweek_reconciliation_state", { p_publication_id: values.publicationId, p_publication_revision: values.revision,
        p_state: "confirmed", p_error_class: null, p_observed_at: values.observedAt });
    },
  };
}
