import "server-only";
import type { PublicResourceInput } from "../public-resource-types";
import { planningService } from "./planning-service";

export function authorizePublicResource(input: PublicResourceInput) {
  const action = input.action;
  const historicalId = "targetId" in input ? input.targetId : "";
  const service = planningService(false);
  return { ok: true as const, publicResource: {
    async coreTablesReachable() {
      if (action !== "health.inspect" || !service) return false;
      const checks = await Promise.all((["profiles", "tasks"] as const).map(async table => {
        const { error } = await service.from(table).select("id").limit(1);
        return !error;
      }));
      return checks.every(Boolean);
    },
    async resolveHistoricalInitiative() {
      if (action !== "historical-initiative.resolve" || !service) return historicalId;
      const { data } = await service.from("planning_item_historical_links").select("task_id")
        .eq("item_type", "initiative").eq("historical_id", historicalId).maybeSingle();
      return data?.task_id || historicalId;
    },
  } };
}
