import { NextResponse, type NextRequest } from "next/server";
import { requireTeamMember } from "@/lib/authz";
import { requireJsonApiContext } from "@/lib/api-response";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import {
  taskGitHubSyncFailure,
  taskGitHubSyncHttpStatus,
  type TaskGitHubProjectionResult,
} from "@/lib/github-sync/contract";
import { projectTaskToGitHub } from "@/lib/github-sync/task-projection";

type SyncRequestBody = {
  createIfMissing?: boolean;
};

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

function syncResponse(result: TaskGitHubProjectionResult) {
  return NextResponse.json(result, { status: taskGitHubSyncHttpStatus(result) });
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const apiContext = await requireJsonApiContext<SyncRequestBody>(
    request,
    requireTeamMember,
    {},
  );
  if (!apiContext.ok) {
    return syncResponse(apiContextFailure(apiContext.status, apiContext.error));
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

  const { id } = await context.params;
  const result = await projectTaskToGitHub({
    supabase: apiContext.supabase,
    installationToken,
    taskId: id,
    actorProfileId: apiContext.permission.profile?.id || "",
    createIfMissing: Boolean(apiContext.payload.createIfMissing),
  });
  return syncResponse(result);
}
