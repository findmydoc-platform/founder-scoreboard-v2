import "server-only";

import { Suspense } from "react";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { TaskStatus } from "@/lib/types";
import type { PlanningBoardColumnOutcome, PlanningBoardDelivery, PlanningBoardOutcome, PlanningBoardQueryLoadResult, PlanningBoardSummaryOutcome } from "../model/planning-board-delivery";
import { PlanningServerBoardReceipt } from "../organisms/planning-server-board-receipt";

function failedColumn(readId: string, column: TaskStatus | undefined, error: unknown): Extract<PlanningBoardColumnOutcome, { kind: "failure" }> {
  const status = typeof error === "object" && error !== null && "status" in error
    ? error.status === 401 || error.status === 403 ? 403 : error.status === 409 ? 409 : 503 : 503;
  return { kind: "failure", readId, column, status,
    error: status === 403 ? "Planung darf nicht geladen werden." : status === 409 ? "Die Ergebnisliste hat sich geändert. Bitte erneut laden." : "Die Spalte konnte nicht geladen werden.",
    ...(status === 409 ? { code: "stale_continuation" } : {}),
  };
}

type ReadySummary = Extract<PlanningBoardSummaryOutcome, { kind: "summaries" }>;

async function publishColumn(delivery: PlanningBoardDelivery, column: TaskStatus, result: Promise<PlanningBoardColumnOutcome>, initialSummary?: ReadySummary) {
  try {
    const outcome = await result;
    return initialSummary ? await delivery.checkPublication(outcome, initialSummary) : await delivery.checkPublication(outcome);
  }
  catch (error) { return failedColumn(delivery.id, column, error); }
}

function matchingInitialSummary(model: PlanningWorkspaceModel, outcome: PlanningBoardColumnOutcome, summary: PlanningBoardSummaryOutcome | undefined): summary is ReadySummary {
  const board = model.board!;
  return outcome.kind === "column" && summary?.kind === "summaries" && summary.readId === board.delivery?.id
    && summary.scopeRevision === model.scopeRevision && summary.queryRevision === board.revision
    && summary.observedAt === board.observedAt && summary.validUntil === (board.validUntil ?? null)
    && JSON.stringify(summary.cardIds) === JSON.stringify(outcome.cardIds)
    && board.summaryRequests?.some(request => request.token === summary.token && request.status === "loading"
      && JSON.stringify(request.cardIds) === JSON.stringify(summary.cardIds)) === true
    && summary.cardIds.every(id => summary.childProgressById[id] && Array.isArray(summary.attentionById?.[id]));
}

function mergeInitialColumn(model: PlanningWorkspaceModel, outcome: Extract<PlanningBoardColumnOutcome, { kind: "column" }>, initialSummary?: ReadySummary): PlanningWorkspaceModel {
  const board = model.board!;
  const pending = board.delivery!.columns.filter(column => column !== outcome.column);
  const summaryRequests = initialSummary ? board.summaryRequests?.map(request => request.token === initialSummary.token
    ? { ...request, status: "current" as const } : request) : board.summaryRequests;
  return {
    ...model,
    items: outcome.items,
    relationships: outcome.relationships,
    taskOmittedFields: outcome.taskOmittedFields,
    board: {
      ...board,
      delivery: pending.length || summaryRequests?.some(request => request.status === "loading") ? { id: board.delivery!.id, columns: pending } : undefined,
      summaryRequests,
      cardIds: outcome.cardIds,
      columns: { ...board.columns, [outcome.column]: outcome.columnState },
      childProgressById: initialSummary?.childProgressById ?? Object.fromEntries(outcome.cardIds.map(id => [id, null])),
      attentionById: initialSummary?.attentionById ?? Object.fromEntries(outcome.cardIds.map(id => [id, null])),
      viewerOpenSubIssueIdsByDeliverableId: outcome.personalChildren,
    },
  };
}

export async function preparePlanningServerBoardColumns(result: Extract<PlanningBoardQueryLoadResult, { status: "ready" }>) {
  const { delivery, model } = result;
  if (!delivery || !model.board?.delivery) return { status: "ready" as const, model, delivery };
  const columns = Object.fromEntries(Object.entries(delivery.columns).map(([column, promise]) => [column,
    promise!.catch(error => failedColumn(delivery.id, column as TaskStatus, error)),
  ])) as PlanningBoardDelivery["columns"];
  const entries = Object.entries(columns) as Array<[TaskStatus, Promise<PlanningBoardColumnOutcome>]>;
  if (!entries.length) return delivery.summaries
    ? { status: "ready" as const, model, delivery }
    : { status: "ready" as const, model: { ...model, board: { ...model.board, delivery: undefined } }, delivery: undefined };

  // One settled column can seed operable HTML; no particular status gates it.
  const first = await Promise.race(entries.map(async ([column, promise]) => ({ column, outcome: await promise })));
  let initialSummary: ReadySummary | undefined;
  if (model.board.query.level === "epic" && delivery.summaries) {
    // Never hold a card for its optional summary. A pending or rejected result
    // retains the existing independent Suspense/error path.
    const settled = await Promise.race([delivery.summaries, Promise.resolve(undefined)]).catch(() => undefined);
    if (matchingInitialSummary(model, first.outcome, settled)) initialSummary = settled;
  }
  const outcome = await publishColumn(delivery, first.column, Promise.resolve(first.outcome), initialSummary);
  if (outcome.kind === "failure") {
    if (outcome.status !== 503) { delivery.abort(); return { status: "unavailable" as const }; }
    return { status: "ready" as const, model, delivery: { ...delivery, columns: { ...columns, [first.column]: Promise.resolve(outcome) } } };
  }
  if (outcome.readId !== delivery.id || outcome.column !== first.column || outcome.scopeRevision !== model.scopeRevision
    || outcome.queryRevision !== model.board.revision || outcome.observedAt !== model.board.observedAt
    || outcome.validUntil !== (model.board.validUntil ?? null)
    || initialSummary && !matchingInitialSummary(model, outcome, initialSummary)) {
    delivery.abort();
    return { status: "unavailable" as const };
  }
  const remaining = { ...columns };
  delete remaining[first.column];
  const summaries = initialSummary ? undefined : delivery.summaries;
  return { status: "ready" as const, model: mergeInitialColumn(model, outcome, initialSummary), delivery: Object.keys(remaining).length || summaries ? { ...delivery, columns: remaining, summaries } : undefined };
}

async function BoardColumn({ delivery, column, result }: { delivery: PlanningBoardDelivery; column: TaskStatus; result: Promise<PlanningBoardColumnOutcome> }) {
  const outcome = await publishColumn(delivery, column, result);
  return <PlanningServerBoardReceipt readId={delivery.id} outcome={outcome} />;
}

async function BoardSummaries({ delivery }: { delivery: PlanningBoardDelivery }) {
  let outcome: PlanningBoardOutcome;
  try {
    outcome = await delivery.checkPublication(await delivery.summaries!);
  } catch (error) {
    const failed = failedColumn(delivery.id, undefined, error);
    outcome = { ...failed, area: "summaries",
      error: failed.status === 503 ? "Fortschritt und Signale konnten nicht geladen werden." : failed.error };
  }
  return <PlanningServerBoardReceipt readId={delivery.id} outcome={outcome} />;
}

export function PlanningServerBoardColumns({ delivery }: { delivery: PlanningBoardDelivery }) {
  return <>{(Object.entries(delivery.columns) as Array<[TaskStatus, Promise<PlanningBoardColumnOutcome>]>).map(([column, result]) => (
    <Suspense key={`${delivery.id}:${column}`} fallback={null}>
      <BoardColumn delivery={delivery} column={column} result={result} />
    </Suspense>
  ))}{delivery.summaries ? <Suspense key={`${delivery.id}:summaries`} fallback={null}><BoardSummaries delivery={delivery} /></Suspense> : null}</>;
}
