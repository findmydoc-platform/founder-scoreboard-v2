"use client";

import { ChevronDown, ChevronRight, ChevronUp, GripVertical, Plus } from "lucide-react";
import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { BacklogSprintAssignmentMenu } from "@/features/backlog/molecules/backlog-sprint-actions";
import type { BacklogSprintBucket } from "@/features/backlog/model/backlog-view-model";
import { TaskChildProgress } from "@/features/tasks/atoms/task-child-progress";
import { TaskStatusBadge } from "@/features/tasks/atoms/task-status-control";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { TaskTypeIndicator } from "@/features/tasks/atoms/task-type-indicator";
import { directChildPluralLabel, taskChildProgress } from "@/features/tasks/model/task-card-presentation";
import type { PlanningLevel } from "@/features/planning/model/planning-level";
import { normalizeStatus } from "@/lib/status";
import type { Sprint, Task } from "@/lib/types";
import { classNames, UiBadge, UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";

export type BacklogPlanningLevel = PlanningLevel;

type PlanningBacklogTreeProps = {
  canAssignSprints: boolean;
  canCreate: boolean;
  data: Task[];
  draggedTaskId?: string;
  level: BacklogPlanningLevel;
  onAssignTaskToSprint: (task: Task, sprint: Sprint | null) => void;
  onCreateItem: (taskType: BacklogPlanningLevel) => void;
  onDragTaskEnd?: () => void;
  onDragTaskStart?: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  sprintBuckets: BacklogSprintBucket[];
  sprintById: ReadonlyMap<string, Sprint>;
  visibleTaskIds?: ReadonlySet<string>;
};

type SprintAssignment = {
  buckets: BacklogSprintBucket[];
  canManageBacklog: boolean;
  onAssignTaskToSprint: (task: Task, sprint: Sprint | null) => void;
  sprintById: ReadonlyMap<string, Sprint>;
};

function approvalBadge(task: Task) {
  if (task.taskType === "epic") return null;
  if (task.approvalStatus === "approved") return <UiBadge tone="emerald" shape="rectangular">Freigegeben</UiBadge>;
  if (task.approvalStatus === "proposed") return <UiBadge tone="amber" shape="rectangular">Vorgeschlagen</UiBadge>;
  if (task.approvalStatus === "rejected") return <UiBadge tone="rose" shape="rectangular">Abgelehnt</UiBadge>;
  return <UiBadge tone="slate" shape="rectangular">Entwurf</UiBadge>;
}

function TreeRow({
  childByParent,
  depth,
  draggedTaskId,
  expanded,
  onDragTaskEnd,
  onDragTaskStart,
  onOpenTask,
  onToggle,
  rankByTaskId,
  sprintAssignment,
  task,
}: {
  childByParent: ReadonlyMap<string, Task[]>;
  depth: number;
  draggedTaskId?: string;
  expanded: ReadonlySet<string>;
  onDragTaskEnd?: () => void;
  onDragTaskStart?: (taskId: string) => void;
  onOpenTask: (taskId: string) => void;
  onToggle: (taskId: string) => void;
  rankByTaskId: ReadonlyMap<string, number>;
  sprintAssignment?: SprintAssignment;
  task: Task;
}) {
  const directChildren = childByParent.get(task.id) || [];
  const visibleChildren = task.taskType === "epic"
    ? directChildren.filter((child) => child.taskType === "initiative")
    : task.taskType === "initiative"
      ? directChildren.filter((child) => child.taskType === "deliverable")
      : [];
  const hasChildren = visibleChildren.length > 0;
  const isExpanded = expanded.has(task.id);
  const rollupChildren = task.taskType === "deliverable"
    ? directChildren.filter((child) => child.taskType === "sub_issue")
    : visibleChildren;
  const rollup = taskChildProgress(rollupChildren);
  const rank = task.taskType === "deliverable" ? rankByTaskId.get(task.id) : undefined;
  const isDraggable = task.taskType === "deliverable" && Boolean(onDragTaskStart);
  const isDragging = isDraggable && draggedTaskId === task.id;

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    if (!isDraggable || !onDragTaskStart) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    onDragTaskStart(task.id);
  };

  return (
    <li className="border-b border-slate-200 last:border-b-0">
      <div
        draggable={isDraggable}
        onDragStart={handleDragStart}
        onDragEnd={onDragTaskEnd}
        className={classNames(
          "group flex min-w-0 items-start gap-2 bg-white px-3 py-3 hover:bg-slate-50 sm:px-4",
          isDraggable && "cursor-grab active:cursor-grabbing",
          isDragging && "bg-blue-50/70 opacity-60 ring-2 ring-inset ring-blue-200",
        )}
        style={{ paddingLeft: `${Math.min(1 + depth, 4) * 1.25}rem` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={`${task.title}: direkte Kinder ${isExpanded ? "einklappen" : "aufklappen"}`}
            aria-expanded={isExpanded}
            onClick={() => onToggle(task.id)}
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {isExpanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
          </button>
        ) : isDraggable ? (
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center text-slate-400" title="In einen Sprint ziehen" aria-hidden="true">
            <GripVertical size={16} />
          </span>
        ) : (
          <span className="mt-0.5 h-7 w-7 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <TaskTypeIndicator taskType={task.taskType} size={14} className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-600" />
            {approvalBadge(task)}
            <TaskStatusBadge status={normalizeStatus(task.status)} size="sm" />
          </div>
          <div className="mt-1 flex min-w-0 items-start gap-2">
            {rank ? <span className="mt-px w-8 shrink-0 text-right font-mono text-xs font-semibold tabular-nums text-slate-400">#{rank}</span> : null}
            <TaskReferenceLink task={task} onOpenTask={onOpenTask} draggable={false} className="block w-fit min-w-0 max-w-full text-left text-sm font-semibold text-slate-950 hover:text-blue-700">
              {task.title}
            </TaskReferenceLink>
          </div>
          {rollup.total ? (
            <TaskChildProgress
              className="mt-2 max-w-md"
              completed={rollup.completed}
              label={directChildPluralLabel(task.taskType)}
              leading={task.assignee || <span className="text-amber-700">Owner fehlt</span>}
              percentage={rollup.percentage}
              total={rollup.total}
            />
          ) : null}
          {!rollup.total || task.targetDate || task.fixedDate ? (
            <div className={classNames("flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500", rollup.total ? "mt-2" : "mt-1")}>
              {!rollup.total ? (task.assignee ? <span>{task.assignee}</span> : <span className="text-amber-700">Owner fehlt</span>) : null}
              {task.targetDate ? <span>Zieltermin: {task.targetDate}</span> : task.fixedDate ? <span>Fixtermin: {task.fixedDate}</span> : null}
            </div>
          ) : null}
        </div>
        {isDraggable && sprintAssignment ? (
          <div className="mt-0.5 shrink-0">
            <BacklogSprintAssignmentMenu
              buckets={sprintAssignment.buckets}
              canManageBacklog={sprintAssignment.canManageBacklog}
              onAssignTaskToSprint={sprintAssignment.onAssignTaskToSprint}
              sprintById={sprintAssignment.sprintById}
              task={task}
            />
          </div>
        ) : null}
      </div>
      {hasChildren && isExpanded ? (
        <ul className="border-t border-slate-100 bg-slate-50/40">
          {visibleChildren.map((child) => (
            <TreeRow
              key={child.id}
              childByParent={childByParent}
              depth={depth + 1}
              draggedTaskId={draggedTaskId}
              expanded={expanded}
              onDragTaskEnd={onDragTaskEnd}
              onDragTaskStart={onDragTaskStart}
              onOpenTask={onOpenTask}
              onToggle={onToggle}
              rankByTaskId={rankByTaskId}
              sprintAssignment={sprintAssignment}
              task={child}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

type GroupItemType = "epic" | "initiative" | "deliverable";

function groupItemPluralLabel(itemType: GroupItemType) {
  if (itemType === "epic") return "Epics";
  if (itemType === "initiative") return "Initiativen";
  return "Deliverables";
}

function Group({
  children,
  collapsed,
  groupId,
  itemType,
  onToggle,
  rollupTasks,
  title,
  visibleCount,
}: {
  children: ReactNode;
  collapsed: boolean;
  groupId: string;
  itemType: GroupItemType;
  onToggle: () => void;
  rollupTasks: Task[];
  title: string;
  visibleCount: number;
}) {
  const contentId = `backlog-group-${groupId}`;
  const rollup = taskChildProgress(rollupTasks);
  const rollupLabel = groupItemPluralLabel(itemType);

  return (
    <section aria-label={title} className="overflow-hidden rounded-lg border border-slate-200 border-l-4 border-l-blue-600 bg-white shadow-sm shadow-slate-900/5">
      <button
        type="button"
        aria-controls={contentId}
        aria-expanded={!collapsed}
        aria-label={`${title}: ${rollup.completed} von ${rollup.total} ${rollupLabel} erledigt. Gruppe ${collapsed ? "aufklappen" : "einklappen"}`}
        onClick={onToggle}
        className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-slate-50/90 px-4 py-2.5 text-left hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 sm:grid-cols-[minmax(0,1fr)_minmax(14rem,22rem)_auto]"
      >
        <span className="col-start-1 row-start-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-slate-800">
          <span className="min-w-0 truncate">{title}</span>
          {visibleCount < rollup.total ? (
            <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
              {visibleCount} von {rollup.total} sichtbar
            </span>
          ) : null}
        </span>
        <TaskChildProgress
          className="col-span-2 row-start-2 w-full sm:col-span-1 sm:col-start-2 sm:row-start-1"
          completed={rollup.completed}
          label={rollupLabel}
          percentage={rollup.percentage}
          total={rollup.total}
        />
        <span className="col-start-2 row-start-1 shrink-0 text-slate-600 sm:col-start-3">
          {collapsed ? <ChevronDown size={18} aria-hidden="true" /> : <ChevronUp size={18} aria-hidden="true" />}
        </span>
      </button>
      <ul id={contentId} hidden={collapsed}>{children}</ul>
    </section>
  );
}

export function PlanningBacklogTree({
  canAssignSprints,
  canCreate,
  data,
  draggedTaskId,
  level,
  onAssignTaskToSprint,
  onCreateItem,
  onDragTaskEnd,
  onDragTaskStart,
  onOpenTask,
  sprintBuckets,
  sprintById,
  visibleTaskIds,
}: PlanningBacklogTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const childByParent = useMemo(() => {
    const result = new Map<string, Task[]>();
    for (const task of data) {
      if (!task.parentTaskId) continue;
      result.set(task.parentTaskId, [...(result.get(task.parentTaskId) || []), task]);
    }
    for (const children of result.values()) children.sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "de"));
    return result;
  }, [data]);
  const epics = useMemo(() => data.filter((task) => task.taskType === "epic").sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "de")), [data]);
  const initiatives = useMemo(() => data.filter((task) => task.taskType === "initiative").sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "de")), [data]);
  const deliverables = useMemo(() => data.filter((task) => task.taskType === "deliverable").sort((left, right) => left.order - right.order || left.title.localeCompare(right.title, "de")), [data]);
  const rankByTaskId = useMemo(
    () => new Map(deliverables.map((task, index) => [task.id, index + 1])),
    [deliverables],
  );
  const toggle = (taskId: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    return next;
  });
  const toggleGroup = (groupId: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(groupId)) next.delete(groupId);
    else next.add(groupId);
    return next;
  });
  const sprintAssignment = canAssignSprints && level === "deliverable" ? {
    buckets: sprintBuckets,
    canManageBacklog: true,
    onAssignTaskToSprint,
    sprintById,
  } : undefined;
  const row = (task: Task, depth = 0) => (
    <TreeRow
      key={task.id}
      childByParent={childByParent}
      depth={depth}
      draggedTaskId={draggedTaskId}
      expanded={expanded}
      onDragTaskEnd={onDragTaskEnd}
      onDragTaskStart={onDragTaskStart}
      onOpenTask={onOpenTask}
      onToggle={toggle}
      rankByTaskId={rankByTaskId}
      sprintAssignment={sprintAssignment}
      task={task}
    />
  );
  const orphanInitiatives = initiatives.filter((task) => !task.parentTaskId);
  const orphanDeliverables = deliverables.filter((task) => !task.parentTaskId);
  const epicById = new Map(epics.map((epic) => [epic.id, epic]));
  const visibleAtCurrentLevel = (task: Task) => task.taskType !== level || !visibleTaskIds || visibleTaskIds.has(task.id);
  const visibleEpics = epics.filter(visibleAtCurrentLevel);
  const visibleInitiatives = initiatives.filter(visibleAtCurrentLevel);
  const visibleDeliverables = deliverables.filter(visibleAtCurrentLevel);
  const visibleOrphanInitiatives = orphanInitiatives.filter(visibleAtCurrentLevel);
  const visibleOrphanDeliverables = orphanDeliverables.filter(visibleAtCurrentLevel);
  const group = (groupId: string, itemType: GroupItemType, title: string, tasks: Task[], rollupTasks = tasks) => (
    <Group
      key={groupId}
      collapsed={collapsedGroups.has(groupId)}
      groupId={groupId}
      itemType={itemType}
      onToggle={() => toggleGroup(groupId)}
      rollupTasks={rollupTasks}
      title={title}
      visibleCount={tasks.length}
    >
      {tasks.map((task) => row(task))}
    </Group>
  );

  const groups = level === "epic"
    ? [
        visibleEpics.length ? group("epic:all", "epic", "Epics", visibleEpics, epics) : null,
        visibleOrphanInitiatives.length ? group("epic:orphan-initiatives", "initiative", "Ohne Epic", visibleOrphanInitiatives, orphanInitiatives) : null,
        visibleOrphanDeliverables.length ? group("epic:orphan-deliverables", "deliverable", "Ohne Initiative", visibleOrphanDeliverables, orphanDeliverables) : null,
      ]
    : level === "initiative"
      ? [
          ...epics.map((epic) => {
            const allChildren = initiatives.filter((initiative) => initiative.parentTaskId === epic.id);
            const children = visibleInitiatives.filter((initiative) => initiative.parentTaskId === epic.id);
            const groupId = `initiative:${epic.id}`;
            return children.length ? group(groupId, "initiative", epic.title, children, allChildren) : null;
          }),
          visibleOrphanInitiatives.length ? group("initiative:orphan", "initiative", "Ohne Epic", visibleOrphanInitiatives, orphanInitiatives) : null,
        ]
      : [
        ...initiatives.map((initiative) => {
          const allChildren = deliverables.filter((deliverable) => deliverable.parentTaskId === initiative.id);
          const children = visibleDeliverables.filter((deliverable) => deliverable.parentTaskId === initiative.id);
          const epic = initiative.parentTaskId ? epicById.get(initiative.parentTaskId) : null;
          const title = epic ? `${epic.title} · ${initiative.title}` : initiative.title;
          const groupId = `deliverable:${initiative.id}`;
          return children.length ? group(groupId, "deliverable", title, children, allChildren) : null;
        }),
        visibleOrphanDeliverables.length ? group("deliverable:orphan", "deliverable", "Ohne Initiative", visibleOrphanDeliverables, orphanDeliverables) : null,
      ];
  const visibleGroups = groups.filter(Boolean);
  const label = level === "epic" ? "Epic" : level === "initiative" ? "Initiative" : "Deliverable";

  return (
    <div className="grid gap-4" data-tour-id="backlog-level-tree">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          {level === "deliverable"
            ? "Deliverables in einen Sprint ziehen. Ein Klick auf das Item öffnet sein Detail."
            : "Der Pfeil öffnet nur direkte Kinder. Ein Klick auf das Item öffnet sein Detail."}
        </p>
        {canCreate ? <UiButton variant="blue" size="sm" onClick={() => onCreateItem(level)}><Plus size={15} /> {label} anlegen</UiButton> : null}
      </div>
      {visibleGroups.length ? <div className="grid gap-4">{visibleGroups}</div> : (
        <UiEmptyState className="border border-dashed border-slate-300 bg-white px-6 py-12">
          <div className="grid justify-items-center gap-3 text-center">
            <span>Noch keine {level === "epic" ? "Epics" : level === "initiative" ? "Initiativen" : "Deliverables"} vorhanden.</span>
            {canCreate ? <UiButton variant="blue" size="sm" onClick={() => onCreateItem(level)}><Plus size={15} /> {label} anlegen</UiButton> : null}
          </div>
        </UiEmptyState>
      )}
    </div>
  );
}
