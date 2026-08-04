"use client";

import { CalendarPlus, X } from "lucide-react";
import type { DragEvent } from "react";
import {
  backlogSprintAssignmentMessage,
  getBacklogBulkSprintAssignmentState,
  getBacklogSprintAssignmentEligibility,
} from "@/features/backlog/model/backlog-planning-state";
import type { BacklogSprintBucket } from "@/features/backlog/model/backlog-view-model";
import type { Sprint, Task } from "@/lib/types";
import { CustomActionMenu, type CustomActionMenuGroup } from "@/shared/molecules/custom-action-menu";

type BacklogSprintActionOptions = {
  buckets: BacklogSprintBucket[];
  canManageBacklog: boolean;
  onAssignTaskToSprint: (task: Task, sprint: Sprint | null) => void;
  sprintById: ReadonlyMap<string, Sprint>;
  task: Task;
};

type BacklogBulkSprintAssignmentOptions = {
  buckets: BacklogSprintBucket[];
  canManageBacklog: boolean;
  isPending: boolean;
  onAssignTasksToSprint: (tasks: Task[], sprint: Sprint) => Promise<boolean>;
  selectedTasks: Task[];
  sprintById: ReadonlyMap<string, Sprint>;
};

function currentSprintLocked(task: { sprintId?: string | null }, sprintById: ReadonlyMap<string, Sprint>) {
  return Boolean(task.sprintId && sprintById.get(task.sprintId)?.scoreLocked);
}

export function buildBacklogSprintActionGroup({
  buckets,
  canManageBacklog,
  onAssignTaskToSprint,
  sprintById,
  task,
}: BacklogSprintActionOptions): CustomActionMenuGroup {
  const sourceSprintLocked = currentSprintLocked(task, sprintById);

  return {
    id: "sprint",
    label: "Sprint",
    items: [
      ...buckets.map((bucket) => {
        const eligibility = getBacklogSprintAssignmentEligibility(task, bucket.sprint, {
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
          onSelect: () => onAssignTaskToSprint(task, bucket.sprint),
        };
      }),
      (() => {
        const eligibility = getBacklogSprintAssignmentEligibility(task, null, {
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
          onSelect: () => onAssignTaskToSprint(task, null),
        };
      })(),
    ],
  };
}

export function BacklogSprintAssignmentMenu(options: BacklogSprintActionOptions) {
  const { task } = options;

  return (
    <CustomActionMenu
      label={`Sprint-Zuordnung für ${task.title}`}
      triggerAriaLabel={`Sprint für ${task.title} zuordnen`}
      triggerIcon={<CalendarPlus size={16} aria-hidden="true" />}
      triggerClassName="h-8 min-h-8 w-8 min-w-8 shrink-0 border-slate-200 text-slate-500 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
      triggerButtonProps={{
        draggable: false,
        title: "Sprint zuordnen",
        onDragStart: (event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.stopPropagation();
        },
      }}
      groups={[buildBacklogSprintActionGroup(options)]}
    />
  );
}

export function BacklogBulkSprintAssignmentMenu({
  buckets,
  canManageBacklog,
  isPending,
  onAssignTasksToSprint,
  selectedTasks,
  sprintById,
}: BacklogBulkSprintAssignmentOptions) {
  const items = buckets.map((bucket) => {
    const state = getBacklogBulkSprintAssignmentState(selectedTasks, bucket.sprint, {
      canManage: canManageBacklog,
      isPending,
      sourceSprintLocked: (task) => currentSprintLocked(task, sprintById),
    });

    return {
      id: `bulk-sprint-${bucket.sprint.id}`,
      label: `In ${bucket.sprint.name}${bucket.isCurrent ? " (aktuell)" : ""} einplanen`,
      icon: <CalendarPlus size={15} />,
      disabled: state.disabled,
      disabledReason: state.disabledReason,
      onSelect: () => void onAssignTasksToSprint(selectedTasks, bucket.sprint),
    };
  });

  return (
    <CustomActionMenu
      label="Ausgewählte Deliverables einem Sprint zuordnen"
      triggerAriaLabel={`${selectedTasks.length} ausgewählte Deliverables einem Sprint zuordnen`}
      triggerIcon={<CalendarPlus size={16} aria-hidden="true" />}
      triggerLabel={isPending ? "Wird zugeordnet …" : "Sprint zuweisen"}
      triggerClassName="h-8 min-h-8 border-blue-200 bg-white text-blue-700 hover:bg-blue-50"
      disabled={!selectedTasks.length || isPending}
      groups={[{ id: "bulk-sprint", label: "Sprint zuweisen", items }]}
    />
  );
}
