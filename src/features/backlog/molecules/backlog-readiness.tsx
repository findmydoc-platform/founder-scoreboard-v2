import { backlogPlanningStateLabel } from "@/features/backlog/model/backlog-planning-state";
import type { BacklogItem } from "@/features/backlog/model/backlog-view-model";
import { UiBadge } from "@/shared/atoms/ui-primitives";

const planningStateTone = {
  ready: "emerald",
  scheduled: "blue",
  blocked: "amber",
  completed: "slate",
  unsupported: "slate",
} as const;

export function BacklogReadiness({ item }: { item: BacklogItem }) {
  const label = backlogPlanningStateLabel(item.planningState);
  return (
    <UiBadge
      tone={planningStateTone[item.planningState.kind]}
      shape="rectangular"
      title={label}
      className="max-w-44 whitespace-normal text-left leading-4"
    >
      {label}
    </UiBadge>
  );
}
