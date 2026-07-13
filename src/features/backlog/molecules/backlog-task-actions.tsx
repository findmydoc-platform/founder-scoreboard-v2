import { ArrowDown, ArrowUp, CalendarPlus, ChevronsDown, ChevronsUp, GripVertical, X } from "lucide-react";
import type { DragEvent } from "react";
import {
  backlogSprintAssignmentMessage,
  getBacklogSprintAssignmentEligibility,
} from "@/features/backlog/model/backlog-planning-state";
import type { BacklogMoveAction, BacklogMoveResult } from "@/features/backlog/hooks/use-backlog-ordering";
import type { BacklogItem, BacklogSprintBucket } from "@/features/backlog/model/backlog-view-model";
import type { Sprint, Task } from "@/lib/types";
import { CustomActionMenu, type CustomActionMenuGroup } from "@/shared/molecules/custom-action-menu";

type BacklogTaskActionsProps = {
  buckets: BacklogSprintBucket[];
  canManageBacklog: boolean;
  canReorder: boolean;
  index: number;
  isReordering: boolean;
  item: BacklogItem;
  onAssignTaskToSprint: (task: Task, sprint: Sprint | null) => void;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>, taskId: string) => void;
  onMoveTask: (taskId: string, action: BacklogMoveAction) => BacklogMoveResult;
  total: number;
  sprintById: ReadonlyMap<string, Sprint>;
};

function rankDisabledReason({ canManageBacklog, canReorder, isReordering }: Pick<BacklogTaskActionsProps, "canManageBacklog" | "canReorder" | "isReordering">) {
  if (!canManageBacklog) return "Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.";
  if (!canReorder) return "Rangaktionen sind nur in der vollständigen, nach Rang sortierten Backlog-Liste verfügbar.";
  if (isReordering) return "Die Rangfolge wird gerade gespeichert.";
  return "";
}

function currentSprintLocked(task: Task, sprintById: ReadonlyMap<string, Sprint>) {
  return Boolean(task.sprintId && sprintById.get(task.sprintId)?.scoreLocked);
}

export function BacklogTaskActions({
  buckets,
  canManageBacklog,
  canReorder,
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
  const rankReason = rankDisabledReason({ canManageBacklog, canReorder, isReordering });
  const rankDisabled = Boolean(rankReason);
  const topDisabled = rankDisabled || index === 0;
  const bottomDisabled = rankDisabled || index === total - 1;
  const sourceSprintLocked = currentSprintLocked(item.task, sprintById);
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
          onSelect: () => onMoveTask(item.task.id, "top"),
        },
        {
          id: "up",
          label: "Eine Position nach oben",
          icon: <ArrowUp size={15} />,
          disabled: topDisabled,
          disabledReason: topDisabled ? rankReason || "Die Aufgabe steht bereits an erster Stelle." : undefined,
          onSelect: () => onMoveTask(item.task.id, "up"),
        },
        {
          id: "down",
          label: "Eine Position nach unten",
          icon: <ArrowDown size={15} />,
          disabled: bottomDisabled,
          disabledReason: bottomDisabled ? rankReason || "Die Aufgabe steht bereits an letzter Stelle." : undefined,
          onSelect: () => onMoveTask(item.task.id, "down"),
        },
        {
          id: "bottom",
          label: "Ganz nach unten",
          icon: <ChevronsDown size={15} />,
          disabled: bottomDisabled,
          disabledReason: bottomDisabled ? rankReason || "Die Aufgabe steht bereits an letzter Stelle." : undefined,
          onSelect: () => onMoveTask(item.task.id, "bottom"),
        },
      ],
    },
    {
      id: "sprint",
      label: "Sprint",
      items: [
        ...buckets.map((bucket) => {
          const eligibility = getBacklogSprintAssignmentEligibility(item.task, bucket.sprint, {
            canManage: canManageBacklog,
            sourceSprintLocked,
          });
          const alreadyAssigned = eligibility.action === "noop" && eligibility.reason === "already_assigned";
          return {
            id: `sprint-${bucket.sprint.id}`,
            label: `In ${bucket.sprint.name}${bucket.isCurrent ? " (aktuell)" : ""} einplanen`,
            icon: <CalendarPlus size={15} />,
            disabled: !eligibility.ok || eligibility.action === "noop",
            disabledReason: !eligibility.ok || eligibility.action === "noop"
              ? alreadyAssigned
                ? "Die Aufgabe ist diesem Sprint bereits zugeordnet."
                : backlogSprintAssignmentMessage(eligibility.reason)
              : undefined,
            onSelect: () => onAssignTaskToSprint(item.task, bucket.sprint),
          };
        }),
        (() => {
          const eligibility = getBacklogSprintAssignmentEligibility(item.task, null, {
            canManage: canManageBacklog,
            sourceSprintLocked,
          });
          return {
            id: "unassign-sprint",
            label: "Aus Sprint entfernen",
            icon: <X size={15} />,
            disabled: !eligibility.ok || eligibility.action === "noop",
            disabledReason: !eligibility.ok || eligibility.action === "noop"
              ? backlogSprintAssignmentMessage(eligibility.reason)
              : undefined,
            onSelect: () => onAssignTaskToSprint(item.task, null),
          };
        })(),
      ],
    },
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
      groups={sprintGroups}
    />
  );
}
