import type { SupabaseClient } from "@supabase/supabase-js";
import type { PreparedWorkweekPublication } from "./team-workweek-publication-core";
import type { PreparedWorkweekEffect } from "./team-workweek-immediate-effects";

type RpcResult = { data: Awaited<ReturnType<SupabaseClient["rpc"]>>["data"]; error: { code?: string; message: string } | null };
export type WorkweekPublicationBookkeeping = {
  claim(purpose: "publish" | "cleanup"): Promise<RpcResult>;
  recordWrite(operationId: string, effectId: string, state: "settled" | "uncertain" | "observed"): Promise<RpcResult>;
  finish(operationId: string): Promise<RpcResult>;
  confirmEffect(effectId: string, generation: number, etag: string, payload: PreparedWorkweekEffect["payload"]): Promise<RpcResult>;
  preparedEffects(effects: readonly PreparedWorkweekEffect[]): void;
  confirmCleanup(effectId: string, generation: number, etag: string | null, preserved: boolean): Promise<RpcResult>;
  delay(errorClass: string, observedAt: string): Promise<RpcResult>;
};
export type WorkweekBookkeeping = {
  forPublication(publication: PreparedWorkweekPublication | Pick<PreparedWorkweekPublication, "id" | "ownerProfileId" | "attemptGeneration" | "writeJournalVersion" | "effects" | "publicationRevision">): WorkweekPublicationBookkeeping;
  published(publication: { id: string; status: string }): void;
  completeConflict(values: { publicationId: string; conflictId: string; ownerProfileId: string; revision: number; resolvedAt: string }): Promise<RpcResult>;
  recordReconciliation(values: { publicationId: string; revision: number; observedAt: string }): Promise<RpcResult>;
};
