import type { HTMLAttributes } from "react";
import { classNames } from "@/shared/atoms/ui-primitives";

export function UiSkeletonPulse({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classNames("animate-pulse rounded bg-slate-200", className)} {...props} />;
}

type UiSkeletonChipsProps = {
  count?: number;
};

export function UiSkeletonChips({ count = 4 }: UiSkeletonChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {Array.from({ length: count }).map((_, index) => (
        <UiSkeletonPulse key={index} className={index === 0 ? "h-9 w-20 bg-slate-100" : "h-9 w-28 bg-slate-100"} />
      ))}
    </div>
  );
}
