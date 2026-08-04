import { NextResponse, type NextRequest } from "next/server";
import { requireTeamMember } from "@/lib/authz";
import { requireJsonApiContext } from "@/lib/api-response";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import {
  parseTaskGitHubSyncCommand,
  taskGitHubSyncFailure,
  taskGitHubSyncHttpStatus,
  type TaskGitHubProjectionResult,
} from "@/lib/github-sync/contract";
import { projectTaskToGitHub } from "@/lib/github-sync/task-projection";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";

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
  const apiContext = await requireJsonApiContext<unknown>(
    request,
    requireTeamMember,
    null,
  );
  if (!apiContext.ok) {
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

  const { id } = await context.params;
  const { data: task, error: taskError } = await apiContext.supabase
    .from(ACTIVE_TASKS_TABLE)
    .select("task_type")
    .eq("id", id)
    .maybeSingle();
  if (taskError || !task) {
    return syncResponse(taskGitHubSyncFailure("github_sync_not_found", "Planungselement wurde nicht gefunden."));
  }
  if (task.task_type === "epic" || task.task_type === "initiative") {
    return syncResponse(taskGitHubSyncFailure("github_sync_invalid_target", "Strategische Planungselemente werden nicht mit GitHub synchronisiert."));
  }

  let installationToken = "";
  try {
    installationToken = await getGitHubAppInstallationToken();
  } catch (error) {
    return syncResponse(taskGitHubSyncFailure(
      "github_sync_unavailable",
      error instanceof Error
        ? error.message
        : "GitHub-Verbindung konnte nicht geprüft werden.",
    ));
  }

  const result = await projectTaskToGitHub({
    supabase: apiContext.supabase,
    installationToken,
    taskId: id,
    actorProfileId: apiContext.permission.profile?.id || "",
    createIfMissing: command.createIfMissing,
  });
  return syncResponse(result);
}
