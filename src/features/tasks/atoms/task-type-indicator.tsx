import { PackageCheck, Route, SquareCheckBig, Target } from "lucide-react";
import type { TaskType } from "@/lib/types";
import { classNames } from "@/shared/atoms/ui-primitives";

const taskTypePresentation = {
  epic: {
    Icon: Target,
    iconClassName: "text-orange-600",
    label: "Epic",
  },
  initiative: {
    Icon: Route,
    iconClassName: "text-violet-600",
    label: "Initiative",
  },
  deliverable: {
    Icon: PackageCheck,
    iconClassName: "text-green-700",
    label: "Deliverable",
  },
  sub_issue: {
    Icon: SquareCheckBig,
    iconClassName: "text-yellow-600",
    label: "Sub-Issue",
  },
} satisfies Record<TaskType, {
  Icon: typeof Target;
  iconClassName: string;
  label: string;
}>;

export function taskTypeLabel(taskType: TaskType) {
  return taskTypePresentation[taskType].label;
}

export function taskTypeColorClassName(taskType: TaskType) {
  return taskTypePresentation[taskType].iconClassName;
}

export function TaskTypeIcon({
  taskType,
  className,
  size = 16,
}: {
  taskType: TaskType;
  className?: string;
  size?: number;
}) {
  const { Icon, iconClassName } = taskTypePresentation[taskType];

  return (
    <Icon
      size={size}
      strokeWidth={1.75}
      className={classNames("shrink-0", iconClassName, className)}
      aria-hidden="true"
    />
  );
}

export function TaskTypeIndicator({
  taskType,
  className,
  iconClassName,
  label,
  size = 16,
}: {
  taskType: TaskType;
  className?: string;
  iconClassName?: string;
  label?: string;
  size?: number;
}) {
  return (
    <span className={classNames("inline-flex min-w-0 items-center gap-1.5", className)}>
      <TaskTypeIcon taskType={taskType} size={size} className={iconClassName} />
      <span>{label || taskTypeLabel(taskType)}</span>
    </span>
  );
}
