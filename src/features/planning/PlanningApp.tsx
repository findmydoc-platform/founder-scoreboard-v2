"use client";

import { usePlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { PlanningAppShell } from "@/features/planning/templates/planning-app-shell";
import type { PlanningData } from "@/lib/types";

type Props = {
  initialData: PlanningData;
  source: "seed" | "supabase";
  authRequired: boolean;
  initialTaskId?: string;
  initialReviewTaskId?: string;
};

export function PlanningApp({ initialData, source, authRequired, initialTaskId = "", initialReviewTaskId = "" }: Props) {
  const controller = usePlanningAppController({ initialData, source, authRequired, initialTaskId, initialReviewTaskId });

  return <PlanningAppShell authRequired={authRequired} controller={controller} source={source} />;
}
