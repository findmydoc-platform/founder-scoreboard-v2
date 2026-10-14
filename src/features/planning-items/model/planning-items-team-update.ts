import type { AuthenticatedProfile } from "@/lib/types";
import type { getServerSupabase } from "@/lib/supabase";
import type { ContentLengthError } from "@/lib/github-issue-content";
import type { ActorContext } from "./actor-context";
import type { PlanningInvocation, PlanningError } from "./planning-items";
import type { PlanningItemGitHubSyncResult } from "./planning-items-contract";
import {
  buildPlanningItemUpdatePreview,
  createTeamRevisePlanningItems,
  planningItemUpdateHash,
  planningItemReviseCommand,
  teamReviseTransactionFromResult,
  type PlanningItemReplayType,
  type PlanningItemUpdatePreview,
  type parsePlanningItemPatchPayload,
} from "@/features/planning-items/model/planning-item-update";
import {
  changePlanningParentCommand,
  createPlanningReparentPlanningItems,
  planningReparentError,
  planningReparentHash,
} from "@/features/planning-items/model/planning-items-reparent";
import {
  commitTeamPlanningDependency,
  planningDependencyUpdateHash,
  type TeamPlanningDependencyChange,
} from "@/features/planning-items/model/planning-items-team-dependency";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;
type ParsedUpdate = Extract<ReturnType<typeof parsePlanningItemPatchPayload>, { ok: true }>;

type UpdateTransaction = {
  replayed?: boolean;
  commandKind?: "changeParent" | "dependency";
  itemType?: PlanningItemReplayType;
  item?: Record<string, unknown>;
  changedFields?: readonly string[];
  systemEffects?: readonly unknown[];
  warnings?: readonly string[];
  githubSync?: PlanningItemGitHubSyncResult;
  projectionOperationId?: string;
  dependencyChange?: TeamPlanningDependencyChange;
};

export type TeamPlanningItemUpdateTransaction = UpdateTransaction & {
  itemType: PlanningItemReplayType;
  item: Record<string, unknown>;
};

type UpdateFailure = Readonly<{
  ok: false;
  status: number;
  error: string;
  code?: string;
  details?: Readonly<{
    errors: readonly string[];
    warnings: readonly string[];
    lengthErrors?: readonly ContentLengthError[];
  }>;
}>;

type UpdateResult = Readonly<{ ok: true; transaction: TeamPlanningItemUpdateTransaction }> | UpdateFailure;
type StoredUpdate = Readonly<{
  request_hash: string;
  response: UpdateTransaction | null;
  contract_version: number | null;
}>;

type UpdateDependencies = Readonly<{
  supabase: SupabaseServer;
  dispatchGitHubProjections: (supabase: SupabaseServer, operationId: string) => Promise<Map<string, PlanningItemGitHubSyncResult>>;
  scheduleAfter: (callback: () => Promise<void>) => void;
}>;

function failure(error: string, status: number, code?: string): UpdateFailure {
  return { ok: false, error, status, ...(code ? { code } : {}) };
}

function completed(transaction: UpdateTransaction): UpdateResult {
  if (!transaction.item || !transaction.itemType) throw new Error("Planning-Items-Update lieferte kein Element zurück.");
  return { ok: true, transaction: { ...transaction, item: transaction.item, itemType: transaction.itemType } };
}

function invalidPreview(preview: PlanningItemUpdatePreview): UpdateFailure {
  return {
    ok: false,
    status: 400,
    error: "Planning-Items-Update enthält ungültige Felder.",
    details: {
      errors: preview.errors,
      warnings: preview.warnings,
      ...(preview.lengthErrors?.length ? { lengthErrors: preview.lengthErrors } : {}),
    },
  };
}

function reviseFailure(error: PlanningError, preview: PlanningItemUpdatePreview): UpdateFailure {
  if (error.code === "forbidden" && error.reason === "planningTokenInactive") {
    return failure("Planning-API-Token ist nicht mehr aktiv.", 401, "TOKEN_INACTIVE");
  }
  if (error.code === "conflict") {
    if (error.reason === "idempotency") return failure("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
    if (error.reason === "revision") return failure("Planungselement wurde zwischenzeitlich geändert. Bitte Kontext erneut laden.", 409);
    if (error.reason === "state" && error.details?.planningReviewReason === "evidenceRequired") {
      return failure("Ergänze vor der Review-Anfrage einen Evidence-Link oder dokumentiere das Ergebnis ohne Link.", 409);
    }
    if (error.reason === "state") return failure("GitHub-Sync ist für dieses Planungselement im aktuellen Zustand nicht möglich.", 409);
  }
  if (error.code === "forbidden") return failure("Planning-API-Berechtigung ist nicht mehr gültig.", 403);
  if (error.code === "invalidCommand") return invalidPreview({ ...preview, errors: error.issues.map((issue) => issue.reason), lengthErrors: undefined });
  throw new Error("Planning-Items-Update konnte nicht gespeichert werden.");
}

export async function commitTeamPlanningItemUpdate(
  { actor, itemId, parsed, idempotencyKey, requestMetadata }: Readonly<{
    actor: ActorContext;
    itemId: string;
    parsed: ParsedUpdate;
    idempotencyKey: string;
    requestMetadata: PlanningInvocation["requestMetadata"];
  }>,
  { supabase, dispatchGitHubProjections, scheduleAfter }: UpdateDependencies,
): Promise<UpdateResult> {
  if (actor.credential.kind !== "planningToken") return failure("Planning-API-Berechtigung ist nicht mehr gültig.", 403);
  const tokenId = actor.credential.tokenId;
  const operationId = `team-update:${tokenId}:${idempotencyKey}`;
  const reparentField = Object.hasOwn(parsed.raw, "parentTaskId") ? "parentTaskId" : null;

  const loadStoredRequest = async (): Promise<StoredUpdate | null> => {
    const result = await supabase
      .from("team_planning_item_update_requests")
      .select("request_hash,response,contract_version")
      .eq("token_id", tokenId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (result.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
    return result.data as StoredUpdate | null;
  };

  const validateReplay = (stored: StoredUpdate): UpdateResult => {
    // Parent-change transactions still write version 2 receipts.
    if (Number(stored.contract_version || 1) < 2) return failure("Idempotency-Key gehört zu einem älteren API-Vertrag.", 409);
    const itemType = stored.response?.itemType;
    if (!itemType) throw new Error("Gespeicherte Planning-Items-Wiederholung ist unvollständig.");
    if (String(stored.response?.item?.id || "") !== itemId) return failure("Planungselement wurde nicht gefunden.", 404);
    if (itemType === "epic" && !["ceo", "deputy"].includes(actor.platformRole)) {
      return failure("Nur CEO oder Deputy können Epics bearbeiten.", 403);
    }
    const requestHash = stored.response?.commandKind === "changeParent" && reparentField
      ? planningReparentHash(itemId, parsed.expectedUpdatedAt, String(parsed.raw[reparentField] || "") || null)
      : stored.response?.commandKind === "dependency" && parsed.dependency
        ? planningDependencyUpdateHash(itemId, parsed.expectedUpdatedAt, parsed.dependency)
        : planningItemUpdateHash({ itemId, itemType, expectedUpdatedAt: parsed.expectedUpdatedAt, patch: parsed.raw });
    if (requestHash !== stored.request_hash) return failure("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
    return completed({ ...stored.response, replayed: true });
  };

  const replay = async (stored: StoredUpdate): Promise<UpdateResult> => {
    const validated = validateReplay(stored);
    if (!validated.ok || parsed.githubSyncMode !== "wait") return validated;
    await dispatchGitHubProjections(supabase, operationId);
    const refreshed = await loadStoredRequest();
    return refreshed ? validateReplay(refreshed) : validated;
  };

  const finishProjection = async (transaction: UpdateTransaction, projectionOperationId: string, schedule: boolean): Promise<UpdateResult> => {
    if (parsed.githubSyncMode === "wait") {
      const results = await dispatchGitHubProjections(supabase, projectionOperationId);
      return completed({ ...transaction, githubSync: results.get(itemId) });
    }
    if (schedule) scheduleAfter(async () => { await dispatchGitHubProjections(supabase, projectionOperationId); });
    return completed(transaction);
  };

  const existing = await loadStoredRequest();
  if (existing) return replay(existing);

  if (parsed.dependency) {
    const result = await commitTeamPlanningDependency({
      actor,
      itemId,
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      dependency: parsed.dependency,
      supabase,
      tokenId,
      requestHash: planningDependencyUpdateHash(itemId, parsed.expectedUpdatedAt, parsed.dependency),
      idempotencyKey,
      requestMetadata: requestMetadata || {},
    });
    if (!result.ok) {
      if (result.code === "TOKEN_INACTIVE") return failure("Planning-API-Token ist nicht mehr aktiv.", 401, result.code);
      return failure(result.error, result.status, result.code);
    }
    return completed(result.transaction as UpdateTransaction);
  }

  if (reparentField && parsed.presentFields.length !== 1) {
    return failure("Ändere die übergeordnete Planungsebene separat von weiteren Feldern.", 409);
  }
  const prepared = await buildPlanningItemUpdatePreview({
    actor: { id: actor.profileId, platformRole: actor.platformRole } as AuthenticatedProfile,
    itemId,
    parsed,
    supabase,
  });
  if (!prepared.ok) {
    if (!reparentField && prepared.status === 409) {
      const concurrentReplay = await loadStoredRequest();
      if (concurrentReplay) return replay(concurrentReplay);
    }
    return failure(prepared.error, prepared.status);
  }
  const { preview } = prepared;
  if (preview.errors.length) return invalidPreview(preview);

  if (reparentField) {
    const result = await createPlanningReparentPlanningItems(supabase, "any", parsed.githubSync).run({
      actor,
      mode: "commit",
      command: changePlanningParentCommand(itemId, String(parsed.raw[reparentField] || "") || null, parsed.expectedUpdatedAt),
      idempotencyKey,
      requestMetadata,
    });
    if (!result.ok) {
      if (result.error.code === "forbidden" && result.error.reason === "planningTokenInactive") {
        return failure("Planning-API-Token ist nicht mehr aktiv.", 401, "TOKEN_INACTIVE");
      }
      if (result.error.code === "conflict" && result.error.reason === "idempotency") return failure("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
      const mapped = planningReparentError(result.error, "task");
      return failure(mapped.message, mapped.status);
    }
    if (result.status !== "committed") throw new Error("Planning-Items-Parent-Wechsel wurde nicht bestätigt.");
    const committed = await loadStoredRequest();
    const transaction = committed?.response;
    if (!transaction?.item || !transaction.itemType) throw new Error("Planning-Items-Parent-Wechsel lieferte kein Ergebnis zurück.");
    const saved = { ...transaction, replayed: result.replayed };
    return parsed.githubSync && parsed.githubSyncMode
      ? finishProjection(saved, operationId, transaction.githubSync?.status === "accepted")
      : completed(saved);
  }

  const result = await createTeamRevisePlanningItems({ supabase, actor, tokenId, itemId, parsed, preparedPreview: preview }).run({
    actor,
    mode: "commit",
    command: planningItemReviseCommand(itemId, preview.itemType, parsed.expectedUpdatedAt, parsed.raw),
    idempotencyKey,
    requestMetadata,
  });
  if (!result.ok) return reviseFailure(result.error, preview);
  const transaction = teamReviseTransactionFromResult(result);
  if (!transaction) throw new Error("Planning-Items-Update lieferte kein Ergebnis zurück.");
  return parsed.githubSyncMode && transaction.projectionOperationId
    ? finishProjection(transaction, transaction.projectionOperationId, true)
    : completed(transaction);
}
