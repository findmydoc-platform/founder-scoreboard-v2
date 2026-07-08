import { taskPlanningAttentionSignals, taskReviewAttentionSignals, type TaskAttentionSignal } from "@/features/tasks/model/task-attention-signals";
import type { PlanningData, Task } from "@/lib/types";
import { UiBadge, type UiTone } from "@/shared/atoms/ui-primitives";

function signalTone(signal: TaskAttentionSignal): UiTone {
  if (signal.kind === "critical") return "red";
  if (signal.kind === "review") return "blue";
  return "amber";
}

export function TaskAttentionBadges({
  signals,
  compact = false,
  excludeIds = [],
  maxVisible = 2,
}: {
  signals: TaskAttentionSignal[];
  compact?: boolean;
  excludeIds?: string[];
  maxVisible?: number;
}) {
  const visibleCandidates = signals.filter((signal) => !excludeIds.includes(signal.id));
  if (!visibleCandidates.length) return null;

  const visibleSignals = visibleCandidates.slice(0, maxVisible);
  const hiddenCount = visibleCandidates.length - visibleSignals.length;

  return (
    <>
      {visibleSignals.map((signal) => (
        <UiBadge key={signal.id} tone={signalTone(signal)} size="xs" className={compact ? "px-1.5 text-[10px]" : "text-[11px]"}>
          {signal.label}
        </UiBadge>
      ))}
      {hiddenCount > 0 && (
        <UiBadge tone="white" size="xs" className={compact ? "px-1.5 text-[10px]" : "text-[11px]"}>
          +{hiddenCount}
        </UiBadge>
      )}
    </>
  );
}

export function PlanningTaskAttentionBadges({
  task,
  data,
  compact = false,
  excludeIds = [],
}: {
  task: Task;
  data: Pick<PlanningData, "taskBlockers" | "taskRelations" | "tasks">;
  compact?: boolean;
  excludeIds?: string[];
}) {
  return <TaskAttentionBadges signals={taskPlanningAttentionSignals(task, data)} compact={compact} excludeIds={excludeIds} />;
}

export function ReviewTaskAttentionBadges({ task }: { task: Task }) {
  return <TaskAttentionBadges signals={taskReviewAttentionSignals(task)} />;
}
