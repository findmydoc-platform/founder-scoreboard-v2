import type { NextRequest } from "next/server";

export type PlanningTrashMaintenanceInput = {
  credential: { kind: "maintenance-request"; request: NextRequest };
  action: "maintenance.planning-trash.lifecycle" | "maintenance.planning-trash.purge";
};
export type PlanningTrashMaintenanceResult = Awaited<ReturnType<typeof import("./internal/planning-trash-maintenance").authorizePlanningTrashMaintenance>>;
