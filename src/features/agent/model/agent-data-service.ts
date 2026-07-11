import type { AgentTaskFilters } from "@/features/agent/model/agent-contract";
import { projectAgentContext, projectAgentTasks } from "@/features/agent/model/agent-planning-projection";
import { getPlanningData } from "@/lib/planning-data";
import { PlanningDataUnavailableError } from "@/lib/planning-data-availability";

async function loadAgentPlanningData() {
  const result = await getPlanningData();
  if (result.availability === "unavailable") throw new PlanningDataUnavailableError();
  return result;
}

export async function buildAgentContext() {
  const { data, source } = await loadAgentPlanningData();
  return projectAgentContext(data, source);
}

export async function getAgentTasks(filters: AgentTaskFilters) {
  const { data, source } = await loadAgentPlanningData();
  return projectAgentTasks(data, filters, source);
}
