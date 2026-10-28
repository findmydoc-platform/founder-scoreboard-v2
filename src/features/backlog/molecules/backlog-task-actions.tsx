import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, GripVertical } from "lucide-react";
import { useState, type DragEvent } from "react";
import type { BacklogMoveAction, BacklogMoveResult } from "@/features/backlog/model/backlog-ordering";
import type { BacklogItem, BacklogSprintBucket } from "@/features/backlog/model/backlog-view-model";
import { buildBacklogSprintActionGroup } from "@/features/backlog/molecules/backlog-sprint-actions";
import type { Sprint, Task } from "@/lib/types";
import { CustomActionMenu, type CustomActionMenuGroup } from "@/shared/molecules/custom-action-menu";

type BacklogTaskActionsProps = {
  buckets: BacklogSprintBucket[];
  canManageBacklog: boolean;
  canReorder: boolean;
  orderedTasks: Task[];
  index: number;
  isReordering: boolean;
  item: BacklogItem;
  onAssignTaskToSprint: (task: Task, sprint: Sprint | null) => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, taskId: string) => void;
  onMoveTask: (taskId: string, action: BacklogMoveAction, shown?: readonly Task[]) => BacklogMoveResult;
  total: number;
  sprintById: ReadonlyMap<string, Sprint>;
};

function rankDisabledReason({ canManageBacklog, canReorder, isReordering }: Pick<BacklogTaskActionsProps, "canManageBacklog" | "canReorder" | "isReordering">) {
  if (!canManageBacklog) return "Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.";
  if (!canReorder) return "Rangaktionen sind nur in der vollständigen, nach Rang sortierten Backlog-Liste verfügbar.";
  if (isReordering) return "Die Rangfolge wird gerade gespeichert.";
  return "";
}

export function BacklogTaskActions({
  buckets,
  canManageBacklog,
  canReorder,
  orderedTasks,
  index,
  isReordering,
  item,
  onAssignTaskToSprint,
  onDragEnd,
  onDragStart,
  onMoveTask,
  total,
  sprintById,
}: BacklogTaskActionsProps) {
  const [basis, setBasis] = useState<{ task: Task; buckets: BacklogSprintBucket[]; sprints: ReadonlyMap<string, Sprint>; assign: typeof onAssignTaskToSprint; orderedTasks: Task[]; index: number; total: number } | null>(null);
  const rankReason = rankDisabledReason({ canManageBacklog, canReorder, isReordering });
  const rankDisabled = Boolean(rankReason);
  const topDisabled = rankDisabled || (basis?.index ?? index) === 0;
  const bottomDisabled = rankDisabled || (basis?.index ?? index) === (basis?.total ?? total) - 1;
  const sprintGroups: CustomActionMenuGroup[] = [
    {
      id: "rank",
      label: "Rangfolge",
      items: [
        {
          id: "top",
          label: "Ganz nach oben",
          icon: <ChevronsUp size={15} />,
          disabled: topDisabled,
          disabledReason: topDisabled ? rankReason || "Die Aufgabe steht bereits an erster Stelle." : undefined,
          onSelect: () => onMoveTask(item.task.id, "top", basis?.orderedTasks || orderedTasks),
        },
        {
          id: "up",
          label: "Eine Position nach oben",
          icon: <ArrowUp size={15} />,
          disabled: topDisabled,
          disabledReason: topDisabled ? rankReason || "Die Aufgabe steht bereits an erster Stelle." : undefined,
          onSelect: () => onMoveTask(item.task.id, "up", basis?.orderedTasks || orderedTasks),
        },
        {
          id: "down",
          label: "Eine Position nach unten",
          icon: <ArrowDown size={15} />,
          disabled: bottomDisabled,
          disabledReason: bottomDisabled ? rankReason || "Die Aufgabe steht bereits an letzter Stelle." : undefined,
          onSelect: () => onMoveTask(item.task.id, "down", basis?.orderedTasks || orderedTasks),
        },
        {
          id: "bottom",
          label: "Ganz nach unten",
          icon: <ChevronsDown size={15} />,
          disabled: bottomDisabled,
          disabledReason: bottomDisabled ? rankReason || "Die Aufgabe steht bereits an letzter Stelle." : undefined,
          onSelect: () => onMoveTask(item.task.id, "bottom", basis?.orderedTasks || orderedTasks),
        },
      ],
    },
    buildBacklogSprintActionGroup({
      buckets: basis?.buckets || buckets,
      canManageBacklog,
      onAssignTaskToSprint: basis?.assign || onAssignTaskToSprint,
      sprintById: basis?.sprints || sprintById,
      task: basis?.task || item.task,
    }),
  ];

  return (
    <CustomActionMenu
      label={`Aktionen für ${item.task.title}`}
      triggerAriaLabel={`Backlog-Aktionen für ${item.task.title}`}
      triggerIcon={<GripVertical size={17} aria-hidden="true" />}
      triggerClassName="h-8 min-h-8 w-8 min-w-8 rounded-none border-0 bg-transparent p-0 text-slate-500 hover:bg-blue-50 hover:text-blue-700"
      triggerButtonProps={{
        draggable: canManageBacklog && canReorder && !isReordering,
        onDragEnd,
        onDragStart: (event) => onDragStart(event, item.task.id),
        title: canReorder ? "Ziehen oder Aktionsmenü öffnen" : "Aktionsmenü öffnen",
      }}
      onOpenChange={open => setBasis(open ? { task: structuredClone(item.task), buckets: structuredClone(buckets), sprints: new Map(sprintById), assign: onAssignTaskToSprint, orderedTasks: structuredClone(orderedTasks), index, total } : null)}
      groups={sprintGroups}
    />
  );
}
