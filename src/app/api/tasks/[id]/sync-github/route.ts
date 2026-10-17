import { NextResponse, type NextRequest } from "next/server";
import { invalidSessionBeforeEffectErrorCode } from "@/lib/auth-error-contract";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import {
  parseTaskGitHubSyncCommand,
  taskGitHubSyncFailure,
  taskGitHubSyncHttpStatus,
  type TaskGitHubProjectionResult,
} from "@/lib/github-sync/contract";

function apiContextFailure(
  status: number,
  error: string,
): TaskGitHubProjectionResult {
  if (status === 401) {
    return taskGitHubSyncFailure("github_sync_unauthenticated", error);
  }
  if (status === 403) {
    return taskGitHubSyncFailure("github_sync_forbidden", error);
  }
  return taskGitHubSyncFailure("github_sync_unavailable", error);
}

function syncResponse(
  result: TaskGitHubProjectionResult,
  status = taskGitHubSyncHttpStatus(result),
) {
  return NextResponse.json(result, { status });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<unknown>(request, "planning.github-sync.apply", null, id);
  if (!apiContext.ok) {
    if (apiContext.code === invalidSessionBeforeEffectErrorCode) {
      return apiContext.response;
    }
    return syncResponse(
      apiContextFailure(apiContext.status, apiContext.error),
      apiContext.status,
    );
  }
  const command = parseTaskGitHubSyncCommand(apiContext.payload);
  if (!command) {
    return syncResponse(taskGitHubSyncFailure(
      "github_sync_invalid_target",
      "createIfMissing muss als Boolean übergeben werden.",
    ));
  }

  const { data: task, error: taskError } = await apiContext.planning.readProjectionKind();
  if (taskError) {
    return syncResponse(taskGitHubSyncFailure("github_sync_unavailable", "Planungselement konnte nicht geladen werden."));
  }
  if (!task) {
    return syncResponse(taskGitHubSyncFailure("github_sync_not_found", "Planungselement wurde nicht gefunden."));
  }
  if (task.task_type === "epic" || task.task_type === "initiative") {
    return syncResponse(taskGitHubSyncFailure("github_sync_invalid_target", "Strategische Planungselemente werden nicht mit GitHub synchronisiert."));
  }

  const result = await apiContext.planning.projectToGitHub(command.createIfMissing);
  return syncResponse(result);
}
