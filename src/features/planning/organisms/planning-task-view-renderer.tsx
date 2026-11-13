"use client";

import dynamic from "next/dynamic";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { RefreshCw } from "lucide-react";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { initiativePlanningItems, statusOptionsForRole } from "@/features/planning/model/planning-app-model";
import { PlanningViewLoadBoundary } from "@/features/planning/molecules/planning-view-load-boundary";
import { taskAssigneeProfile } from "@/features/tasks/model/task-card-presentation";
import { strategicPlanningStatuses } from "@/features/tasks/model/planning-item-capabilities";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import { TaskSaveNotice } from "@/features/tasks/molecules/task-save-notice";
import { TaskBoardView } from "@/features/tasks/organisms/task-board-view";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

function TaskViewLoading({ label }: { label: string }) {
  return <UiNotice role="status" tone="info">{label} wird geladen …</UiNotice>;
}
function isCardInteraction(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("article, tbody"));
}

const TaskStructureView = dynamic(
  () => import("@/features/tasks/organisms/task-structure-view").then((module) => module.TaskStructureView),
  { loading: () => <TaskViewLoading label="Struktur" /> },
);
const TaskTableView = dynamic(
  () => import("@/features/tasks/organisms/task-table-view").then((module) => module.TaskTableView),
  { loading: () => <TaskViewLoading label="Tabelle" /> },
);
const GanttView = dynamic(
  () => import("@/features/tasks/organisms/gantt-view").then((module) => module.GanttView),
  { loading: () => <TaskViewLoading label="Gantt" /> },
);

export function PlanningTaskViewRenderer({ controller }: { controller: PlanningAppController }) {
  const {
    canChangeTaskStatus: mayChangeTaskStatus,
    canManageFinalTaskStatus,
    canManageTaskMeta,
    data,
    dragOverStatus,
    draggedTaskId,
    dropTaskOnStatus,
    endTaskDrag,
    expandedInitiatives,
    filters: requestedFilters,
    filtersAvailable,
    openTaskPanel,
    planningLevel: requestedLevel,
    planningParentFilterId: requestedParentId,
    selectedTaskId,
    setAllInitiativeCollapse,
    setDragOverStatus,
    setFilters,
    setTaskDialogDefaults,
    setView,
    startTaskDrag,
    toggleInitiativeCollapse,
    updateBoardTask,
    beginBoardTaskEdit,
    boardTaskEditConflict,
    resaveBoardTask,
    reloadBoardTaskConflict,
    view: requestedView,
    viewerOpenSubIssueIdsByDeliverableId,
    visibleTasks,
  } = controller;
  const filters = controller.displayedPlanningQuery?.filters || requestedFilters;
  const planningLevel = controller.displayedPlanningQuery?.level || requestedLevel;
  const planningParentFilterId = controller.displayedPlanningQuery?.parentId || requestedParentId;
  const view = controller.displayedPlanningQuery?.view === "board" ? "board" : requestedView;
  const resultsRef = useRef<HTMLElement>(null);
  const focusInteraction = useRef<(() => void) | undefined>(undefined);
  const pointerInteraction = useRef<(() => void) | undefined>(undefined);
  const focusedResult = useRef<HTMLElement | null>(null);
  const acceptedQuery = JSON.stringify(controller.planningBoard?.query) || controller.planningBoard?.queryKey;
  useEffect(() => {
    if (controller.workspace !== "planning" || view !== "board" || controller.planningQueryReady === false) return;
    const board = controller.planningBoard?.result;
    for (const [status, column] of Object.entries(board?.columns || {})) {
      if (column.availability === "not-loaded" && controller.planningBoard.columnReadStatus?.[status as (typeof taskStatuses)[number]] === "not-loaded") void controller.planningState.loadBoardColumn(status as (typeof taskStatuses)[number]);
    }
  }, [controller.workspace, controller.planningState, controller.planningBoard, controller.planningQueryReady, view]);
  const previousQuery = useRef(acceptedQuery);
  const positionQuery = useRef(acceptedQuery || "planning");
  useLayoutEffect(() => {
    const saved = controller.planningState.planningInteraction().position;
    if (saved?.queryKey === positionQuery.current) {
      resultsRef.current?.querySelector('[aria-label="Board nach Status"]')?.scrollTo({ left: saved.left });
      window.scrollTo({ top: saved.top });
    }
    const remember = () => {
      const board = resultsRef.current?.querySelector('[aria-label="Board nach Status"]');
      controller.planningState.rememberPlanningInteraction({ position: { queryKey: positionQuery.current, top: window.scrollY, left: board?.scrollLeft || 0 } });
    };
    window.addEventListener("scroll", remember, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", remember, true);
  }, [controller.planningState]);
  useEffect(() => {
    const finishPointer = () => { pointerInteraction.current?.(); pointerInteraction.current = undefined; };
    window.addEventListener("pointerup", finishPointer);
    window.addEventListener("pointercancel", finishPointer);
    window.addEventListener("dragend", finishPointer);
    return () => {
      focusInteraction.current?.(); finishPointer();
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", finishPointer);
      window.removeEventListener("dragend", finishPointer);
    };
  }, []);
  useLayoutEffect(() => {
    if (previousQuery.current && acceptedQuery && previousQuery.current !== acceptedQuery) {
      resultsRef.current?.querySelector('[aria-label="Board nach Status"]')?.scrollTo({ left: 0 });
      window.scrollTo({ top: 0 });
    }
    previousQuery.current = acceptedQuery;
    positionQuery.current = acceptedQuery || "planning";
    if (focusedResult.current && !focusedResult.current.isConnected && document.activeElement === document.body) resultsRef.current?.focus({ preventScroll: true });
  });

  const deniedChildListIds = controller.planningBoard?.deniedChildListIds || [];

  const canChangeTaskStatus = (task: (typeof data.tasks)[number]) => mayChangeTaskStatus(task) && controller.planningState.taskDetail(task.id).saveStatus !== "unconfirmed";

  // Table, Gantt and structure stay deliberately delivery-only in V1.  The
  // level selector above is the sole strategic planning surface here.
  const planningBoardTasks = visibleTasks.filter((task) => task.taskType === "deliverable" && isTaskPlanningActive(task));
  const parentFilterId = planningLevel === "deliverable"
    ? filters.initiativeId === "Alle" ? "all" : filters.initiativeId
    : planningParentFilterId;
  const boardTasks = useMemo(() => {
    return visibleTasks.filter((task) => (
      task.taskType === planningLevel
      && (parentFilterId === "all" || task.parentTaskId === parentFilterId)
    ));
  }, [parentFilterId, planningLevel, visibleTasks]);
  const boardStatuses = planningLevel === "deliverable" ? taskStatuses : strategicPlanningStatuses;
  const deliveryOnlyViewLabel = view === "structure" ? "Struktur" : view === "table" ? "Tabelle" : view === "gantt" ? "Gantt" : "";
  const statusOptionsForTask = (task: (typeof data.tasks)[number]) => {
    if (task.taskType !== "epic" && task.taskType !== "initiative") {
      return statusOptionsForRole(task.status, canManageTaskMeta, canManageFinalTaskStatus);
    }
    if (canManageFinalTaskStatus) return strategicPlanningStatuses;
    if (normalizeStatus(task.status) === "Erledigt") return strategicPlanningStatuses.filter((status) => status === "Erledigt");
    return strategicPlanningStatuses.filter((status) => status !== "Erledigt");
  };

  if (!filtersAvailable) return null;
  if (controller.workspace === "planning" && controller.planningBoard?.readStatus === "forbidden") return <UiNotice role="alert" tone="danger">Planung darf nicht geladen werden.</UiNotice>;
  if (controller.planningBoard?.requiresQueryRead && deniedChildListIds.length) return <UiNotice role="alert" tone="danger">
    Kinder dürfen nicht geladen werden.
    <UiButton type="button" aria-disabled={deniedChildListIds.some(id => controller.planningState.taskDetail(id).childrenReadStatus === "loading")} onClick={() => {
      if (deniedChildListIds.some(id => controller.planningState.taskDetail(id).childrenReadStatus === "loading")) return;
      void Promise.all(deniedChildListIds.map(id => controller.planningState.loadTaskDetail(id))).then(results => { if (results.every(result => result.ok)) void controller.retryPlanningQuery(); });
    }}>Kinder erneut laden</UiButton>
  </UiNotice>;
  if (controller.planningQueryReady === false && !controller.planningBoard.query) return <UiNotice role="status" tone="info">
    {controller.planningBoard.readStatus === "unavailable" ? "Diese Ansicht konnte nicht geladen werden." : "Planung wird geladen …"}
    {controller.planningBoard.readStatus === "unavailable" ? <UiButton type="button" onClick={() => void controller.retryPlanningQuery()}>Ansicht erneut laden</UiButton> : null}
  </UiNotice>;

  return (
    <section ref={resultsRef} aria-label="Planungsergebnisse" tabIndex={-1}
      onFocusCapture={event => {
        focusedResult.current = event.target as HTMLElement;
        if (!isCardInteraction(event.target)) return;
        focusInteraction.current ||= controller.planningState.beginBoardInteraction();
      }}
      onBlurCapture={event => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget) && isCardInteraction(event.relatedTarget)) return;
        focusInteraction.current?.(); focusInteraction.current = undefined;
      }}
      onPointerDownCapture={event => { if (isCardInteraction(event.target)) pointerInteraction.current ||= controller.planningState.beginBoardInteraction(); }}
      onPointerUpCapture={() => { pointerInteraction.current?.(); pointerInteraction.current = undefined; }}
      onPointerCancelCapture={() => { pointerInteraction.current?.(); pointerInteraction.current = undefined; }}
      onDragEndCapture={() => { pointerInteraction.current?.(); pointerInteraction.current = undefined; }}
    >
      {controller.planningBoard?.freshness === "stale" || controller.planningBoard?.readStatus === "loading" ? <span role="status" aria-label={controller.planningBoard.readStatus === "loading" ? "Planung wird aktualisiert" : "Planung veraltet"} title={controller.planningBoard.readStatus === "loading" ? "Planung wird aktualisiert" : "Planung veraltet"} className="mx-6 inline-flex text-slate-500">
        <RefreshCw size={14} aria-hidden="true" className={controller.planningBoard.readStatus === "loading" ? "animate-spin motion-reduce:animate-none" : undefined} />
      </span> : null}
      {controller.planningQueryReady === false ? <UiNotice role="status" aria-label="Vorherige Suchergebnisse" tone="info">
        {`Vorherige Suche: ${controller.planningBoard.query?.filters.query || "ohne Suchtext"}. ${controller.planningBoard.readStatus === "unavailable" ? "Neue Ergebnisse konnten nicht geladen werden." : "Neue Ergebnisse werden geladen …"}`}
        {controller.planningBoard.readStatus === "unavailable" ? <UiButton type="button" onClick={() => void controller.retryPlanningQuery()}>Ansicht erneut laden</UiButton> : null}
      </UiNotice> : null}
      {deniedChildListIds.length > 0 ? <UiNotice role="alert" tone="danger">
        Kinder dürfen nicht geladen werden.
        <UiButton type="button" onClick={() => { for (const taskId of deniedChildListIds) void controller.planningState.loadTaskDetail(taskId); }}>Kinder erneut laden</UiButton>
      </UiNotice> : null}
      {controller.workspace === "planning" && controller.planningBoard?.readStatus === "unavailable" ? <UiNotice tone="info" role="alert">
        Der aktuelle Stand konnte nicht geladen werden. Deine geladenen Karten bleiben sichtbar.
        <UiButton type="button" onClick={() => void controller.planningState.refreshWorkspace("planning")}>Planung erneut laden</UiButton>
      </UiNotice> : null}
      {data.tasks.map(task => <TaskSaveNotice key={task.id} taskTitle={controller.planningState.taskDetail(task.id).task ? task.title : "Aufgabe"} saves={controller.planningState.taskSaves(task.id)} labels={{ profiles: data.profiles, tasks: data.tasks, sprints: data.sprints }} onCheck={() => controller.planningState.checkTaskSave(task.id)} />)}
      {boardTaskEditConflict ? <UiNotice tone="info" role="alert" className="mb-4">
        <p>Die Aufgabe wurde inzwischen geändert. Deine Eingaben bleiben erhalten.</p>
        <p className="mt-2">Aktuell gespeichert: {boardTaskEditConflict.serverTask?.title || "Noch nicht verfügbar"}</p>
        <UiButton size="lg" type="button" disabled={!boardTaskEditConflict.canResave} onClick={() => { void resaveBoardTask(); }}>Änderung erneut speichern</UiButton>
        {!boardTaskEditConflict.canResave ? <UiButton size="lg" type="button" onClick={() => { void reloadBoardTaskConflict(); }}>Aktuellen Stand erneut laden</UiButton> : null}
      </UiNotice> : null}
      {deliveryOnlyViewLabel ? (
        <UiNotice className="mb-4" role="status" tone="info">
          {deliveryOnlyViewLabel} zeigt in dieser Version ausschließlich Deliverables. Deine gewählte Board-Ebene bleibt erhalten.
        </UiNotice>
      ) : null}
      {view === "board" && (
        <div className="grid gap-4">
          <TaskBoardView
            key={acceptedQuery}
            childProgressById={controller.planningBoard?.result?.childProgressById}
            attentionById={controller.planningBoard?.result?.attentionById}
            childListForTask={taskId => {
              const detail = controller.planningState.taskDetail(taskId);
              return { items: detail.children, readStatus: detail.childrenReadStatus, load: () => { void controller.planningState.loadTaskDetail(taskId); } };
            }}
            columns={controller.planningBoard?.result ? Object.fromEntries(boardStatuses.map(status => [status, {
              ...controller.planningBoard.result!.columns[status],
              readStatus: controller.planningBoard.columnReadStatus?.[status] || "current",
              onLoadMore: () => { void controller.planningState.loadBoardColumn(status); },
              onRefresh: () => { void controller.planningState.refreshBoardColumn(status); },
            }])) : undefined}
            statuses={boardStatuses}
            itemType={planningLevel}
            visibleTasks={boardTasks}
            relations={data.taskRelations}
            allTasks={data.tasks}
            blockers={data.taskBlockers}
            draggedTaskId={draggedTaskId}
            selectedTaskId={selectedTaskId}
            dragOverStatus={dragOverStatus}
            canChangeTaskStatus={canChangeTaskStatus}
            assigneeProfileForTask={(task) => taskAssigneeProfile(task, data.profiles)}
            onOpenTask={openTaskPanel}
            onCreateTask={setTaskDialogDefaults}
            onBeginTaskEdit={beginBoardTaskEdit}
            onChangeTaskStatus={(task, status) => { void updateBoardTask(task, { status }); }}
            onDragOverStatus={setDragOverStatus}
            onDropTask={dropTaskOnStatus}
            onDragStart={startTaskDrag}
            onDragEnd={endTaskDrag}
            statusOptionsForTask={statusOptionsForTask}
            viewerOpenSubIssueIdsByDeliverableId={viewerOpenSubIssueIdsByDeliverableId}
            showParentContext={parentFilterId === "all" && planningLevel !== "epic"}
          />
        </div>
      )}

      {view !== "board" && (
        <PlanningViewLoadBoundary key={view} onReturnToBoard={() => setView("board")}>
          {view === "structure" && (
            <TaskStructureView
              initiatives={initiativePlanningItems(data.tasks)}
              visibleTasks={planningBoardTasks}
              relations={data.taskRelations}
              allTasks={data.tasks}
              blockers={data.taskBlockers}
              expandedInitiatives={expandedInitiatives}
              assigneeProfileForTask={(task) => taskAssigneeProfile(task, data.profiles)}
              onOpenTask={openTaskPanel}
              onToggleInitiative={toggleInitiativeCollapse}
              onSetAllInitiativeCollapse={setAllInitiativeCollapse}
            />
          )}

          {view === "table" && (
            <TaskTableView
              planningState={controller.planningState}
              visibleTasks={planningBoardTasks}
              profiles={data.profiles}
              sprints={data.sprints}
              relations={data.taskRelations}
              allTasks={data.tasks}
              blockers={data.taskBlockers}
              filters={filters}
              canChangeTaskStatus={canChangeTaskStatus}
              statusOptionsForTask={statusOptionsForTask}
              onOpenTask={openTaskPanel}
              onBeginTaskEdit={beginBoardTaskEdit}
              onUpdateTask={updateBoardTask}
              onFiltersChange={setFilters}
            />
          )}

          {view === "gantt" && (
            <GanttView tasks={planningBoardTasks} items={data.tasks} sprints={data.sprints} relations={data.taskRelations} onOpenTask={openTaskPanel} />
          )}
        </PlanningViewLoadBoundary>
      )}
    </section>
  );
}
