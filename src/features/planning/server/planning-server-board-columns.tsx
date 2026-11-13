import "server-only";

import { Suspense } from "react";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { TaskStatus } from "@/lib/types";
import type { PlanningBoardColumnOutcome, PlanningBoardDelivery, PlanningBoardQueryLoadResult } from "../model/planning-board-delivery";
import { PlanningServerBoardReceipt } from "../organisms/planning-server-board-receipt";

function failedColumn(readId: string, column: TaskStatus, error: unknown): PlanningBoardColumnOutcome {
  const status = typeof error === "object" && error !== null && "status" in error
    ? error.status === 401 || error.status === 403 ? 403 : error.status === 409 ? 409 : 503 : 503;
  return { kind: "failure", readId, column, status,
    error: status === 403 ? "Planung darf nicht geladen werden." : status === 409 ? "Die Ergebnisliste hat sich geändert. Bitte erneut laden." : "Die Spalte konnte nicht geladen werden.",
    ...(status === 409 ? { code: "stale_continuation" } : {}),
  };
}

async function publishColumn(delivery: PlanningBoardDelivery, column: TaskStatus, result: Promise<PlanningBoardColumnOutcome>) {
  try { return await delivery.checkPublication(await result); }
  catch (error) { return failedColumn(delivery.id, column, error); }
}

function mergeInitialColumn(model: PlanningWorkspaceModel, outcome: Extract<PlanningBoardColumnOutcome, { kind: "column" }>): PlanningWorkspaceModel {
  const board = model.board!;
  const pending = board.delivery!.columns.filter(column => column !== outcome.column);
  return {
    ...model,
    items: outcome.items,
    relationships: outcome.relationships,
    taskOmittedFields: outcome.taskOmittedFields,
    board: {
      ...board,
      delivery: pending.length ? { id: board.delivery!.id, columns: pending } : undefined,
      cardIds: outcome.cardIds,
      columns: { ...board.columns, [outcome.column]: outcome.columnState },
      childProgressById: Object.fromEntries(outcome.cardIds.map(id => [id, null])),
      attentionById: Object.fromEntries(outcome.cardIds.map(id => [id, null])),
      viewerOpenSubIssueIdsByDeliverableId: outcome.personalChildren,
    },
  };
}

export async function preparePlanningServerBoardColumns(result: Extract<PlanningBoardQueryLoadResult, { status: "ready" }>) {
  const { delivery, model } = result;
  if (!delivery || !model.board?.delivery) return { model, delivery };
  const columns = Object.fromEntries(Object.entries(delivery.columns).map(([column, promise]) => [column,
    promise!.catch(error => failedColumn(delivery.id, column as TaskStatus, error)),
  ])) as PlanningBoardDelivery["columns"];
  const entries = Object.entries(columns) as Array<[TaskStatus, Promise<PlanningBoardColumnOutcome>]>;
  if (!entries.length) return { model: { ...model, board: { ...model.board, delivery: undefined } }, delivery: undefined };

  // One settled column can seed operable HTML; no particular status gates it.
  const first = await Promise.race(entries.map(async ([column, promise]) => ({ column, outcome: await promise })));
  const outcome = await publishColumn(delivery, first.column, Promise.resolve(first.outcome));
  if (outcome.kind === "failure") {
    return { model, delivery: { ...delivery, columns: { ...columns, [first.column]: Promise.resolve(outcome) } } };
  }
  if (outcome.readId !== delivery.id || outcome.column !== first.column || outcome.scopeRevision !== model.scopeRevision
    || outcome.queryRevision !== model.board.revision || outcome.observedAt !== model.board.observedAt
    || outcome.validUntil !== (model.board.validUntil ?? null)) {
    const failure: PlanningBoardColumnOutcome = { kind: "failure", readId: delivery.id, column: first.column, status: 409,
      error: "Die Ergebnisliste hat sich geändert. Bitte erneut laden.", code: "stale_continuation" };
    return { model, delivery: { ...delivery, columns: { ...columns, [first.column]: Promise.resolve(failure) } } };
  }
  const remaining = { ...columns };
  delete remaining[first.column];
  return { model: mergeInitialColumn(model, outcome), delivery: Object.keys(remaining).length ? { ...delivery, columns: remaining } : undefined };
}

async function BoardColumn({ delivery, column, result }: { delivery: PlanningBoardDelivery; column: TaskStatus; result: Promise<PlanningBoardColumnOutcome> }) {
  const outcome = await publishColumn(delivery, column, result);
  return <PlanningServerBoardReceipt readId={delivery.id} outcome={outcome} />;
}

export function PlanningServerBoardColumns({ delivery }: { delivery: PlanningBoardDelivery }) {
  return <>{(Object.entries(delivery.columns) as Array<[TaskStatus, Promise<PlanningBoardColumnOutcome>]>).map(([column, result]) => (
    <Suspense key={`${delivery.id}:${column}`} fallback={null}>
      <BoardColumn delivery={delivery} column={column} result={result} />
    </Suspense>
  ))}</>;
}
