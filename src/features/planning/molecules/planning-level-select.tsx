"use client";

import { CustomSelect } from "@/shared/atoms/custom-select";
import { classNames } from "@/shared/atoms/ui-primitives";
import { planningLevels, type PlanningLevel } from "@/features/planning/model/planning-level";
import type { Task } from "@/lib/types";

type PlanningLevelSelectProps = {
  ariaLabel: string;
  className?: string;
  onChange: (level: PlanningLevel) => void;
  tasks: Task[];
  value: PlanningLevel;
};

export function PlanningLevelSelect({
  ariaLabel,
  className,
  onChange,
  tasks,
  value,
}: PlanningLevelSelectProps) {
  const options = planningLevels.map((level) => ({
    value: level.value,
    label: `${level.label} · ${tasks.filter((task) => task.taskType === level.value).length}`,
  }));

  return (
    <div className={classNames("flex min-w-0 items-center gap-2", className)}>
      <span className="shrink-0 text-xs font-semibold text-slate-600">Ebene</span>
      <CustomSelect
        aria-label={ariaLabel}
        value={value}
        onChange={(level) => onChange(level as PlanningLevel)}
        options={options}
        className="h-10 min-w-44 flex-1 text-sm"
        menuClassName="min-w-48"
      />
    </div>
  );
}
