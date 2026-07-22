import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requireOperationalLead } from "@/lib/authz";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import { validateFounderOpsGitHubProject } from "@/lib/github-project";
import { validGitHubProjectNumber, validGitHubProjectOwner } from "@/lib/github-project-config";

type GitHubProjectSettingsPayload = {
  expectedGithubProjectOwner?: string;
  expectedGithubProjectNumber?: number;
  githubProjectOwner?: string;
  githubProjectNumber?: number;
};

type GitHubProjectSettingsTransactionResult = {
  project?: {
    id?: string;
    githubProjectOwner?: string;
    githubProjectNumber?: number;
  };
};

const projectId = "findmydoc-founder-execution";

export async function PATCH(request: NextRequest) {
  const context = await requireJsonApiContext<GitHubProjectSettingsPayload>(request, requireOperationalLead, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("CEO- oder Deputy-Profil erforderlich.", 401);
  if (
    !validGitHubProjectOwner(payload.expectedGithubProjectOwner)
    || !validGitHubProjectNumber(payload.expectedGithubProjectNumber)
    || !validGitHubProjectOwner(payload.githubProjectOwner)
    || !validGitHubProjectNumber(payload.githubProjectNumber)
  ) {
    return apiError("GitHub-Organisation oder Project-Nummer ist ungültig.", 400);
  }

  let validation;
  try {
    const token = await getGitHubAppInstallationToken();
    validation = await validateFounderOpsGitHubProject(payload.githubProjectOwner, payload.githubProjectNumber, token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub Project konnte nicht geprüft werden.";
    return apiError(message, 422);
  }

  const metadata = auditRequestMetadata(request);
  const { data, error } = await supabase.rpc("update_founderops_github_project_transaction", {
    p_project_id: projectId,
    p_expected_owner: payload.expectedGithubProjectOwner,
    p_expected_number: payload.expectedGithubProjectNumber,
    p_github_project_owner: payload.githubProjectOwner,
    p_github_project_number: payload.githubProjectNumber,
    p_actor_profile_id: permission.profile.id,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });

  if (error) {
    if (error.code === "P0001") return apiError("Die GitHub-Project-Einstellung wurde parallel geändert. Bitte neu laden.", 409);
    if (error.code === "P0002") return apiError("FounderOps-Projekt wurde nicht gefunden.", 404);
    if (error.code === "P0005") return apiError("Nur der CEO oder ein aktuell aktiver Deputy kann das GitHub Project ändern.", 403);
    if (error.code === "22023") return apiError("GitHub-Organisation oder Project-Nummer ist ungültig.", 400);
    return apiError("Die GitHub-Project-Einstellung konnte nicht gespeichert werden.", 500);
  }

  const result = data as GitHubProjectSettingsTransactionResult | null;
  const savedOwner = result?.project?.githubProjectOwner;
  const savedNumber = result?.project?.githubProjectNumber;
  if (!validGitHubProjectOwner(savedOwner) || !validGitHubProjectNumber(savedNumber)) {
    return apiError("Die GitHub-Project-Einstellung wurde unvollständig gespeichert.", 500);
  }

  return NextResponse.json({
    ok: true,
    project: {
      id: result?.project?.id || projectId,
      githubProjectOwner: savedOwner,
      githubProjectNumber: savedNumber,
    },
    validation: {
      title: validation.title,
      url: validation.url,
      repositories: validation.repositories,
      fields: validation.fields,
    },
  });
}
