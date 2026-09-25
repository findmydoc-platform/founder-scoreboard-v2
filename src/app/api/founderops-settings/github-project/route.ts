import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, authzError } from "@/lib/api-response";
import { bearerToken, requireActiveAdministrator, resolveAdministratorAccessFailure } from "@/lib/authz";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import { validGitHubTeamSlug, validateGitHubMentionTeam } from "@/lib/github-mention-team";
import { validateFounderOpsGitHubProject } from "@/lib/github-project";
import { validGitHubProjectNumber, validGitHubProjectOwner } from "@/lib/github-project-config";
import { getSupabaseForToken } from "@/lib/supabase";

type GitHubProjectSettingsPayload = {
  expectedGithubProjectOwner?: string;
  expectedGithubProjectNumber?: number;
  expectedGithubMentionTeamSlug?: string;
  githubProjectOwner?: string;
  githubProjectNumber?: number;
  githubMentionTeamSlug?: string;
};

type GitHubProjectSettingsTransactionResult = {
  project?: {
    id?: string;
    githubProjectOwner?: string;
    githubProjectNumber?: number;
    githubMentionTeamSlug?: string | null;
  };
};

const projectId = "findmydoc-founder-execution";

export async function PATCH(request: NextRequest) {
  const permission = await requireActiveAdministrator(request);
  if (!permission.ok) return authzError(permission);
  const token = bearerToken(request);
  const supabase = token ? getSupabaseForToken(token) : null;
  if (!supabase) return apiError("Anmeldung erforderlich.", 401);
  const payload = await request.json().catch(() => ({})) as GitHubProjectSettingsPayload;
  const expectedMentionTeamSlug = payload.expectedGithubMentionTeamSlug?.trim().toLowerCase() || "";
  const mentionTeamSlug = payload.githubMentionTeamSlug?.trim().toLowerCase() || "";
  if (
    !validGitHubProjectOwner(payload.expectedGithubProjectOwner)
    || !validGitHubProjectNumber(payload.expectedGithubProjectNumber)
    || !validGitHubProjectOwner(payload.githubProjectOwner)
    || !validGitHubProjectNumber(payload.githubProjectNumber)
    || (mentionTeamSlug !== "" && !validGitHubTeamSlug(mentionTeamSlug))
  ) {
    return apiError("GitHub-Organisation oder Project-Nummer ist ungültig.", 400);
  }

  let validation;
  let mentionTeam = null;
  try {
    const token = await getGitHubAppInstallationToken();
    validation = await validateFounderOpsGitHubProject(payload.githubProjectOwner, payload.githubProjectNumber, token);
    if (mentionTeamSlug) {
      mentionTeam = await validateGitHubMentionTeam(payload.githubProjectOwner, mentionTeamSlug, token);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub Project konnte nicht geprüft werden.";
    return apiError(message, 422);
  }

  const metadata = auditRequestMetadata(request);
  const { data, error } = await supabase.rpc("update_administration_github_project_transaction_v2", {
    p_project_id: projectId,
    p_expected_owner: payload.expectedGithubProjectOwner,
    p_expected_number: payload.expectedGithubProjectNumber,
    p_expected_team_slug: expectedMentionTeamSlug,
    p_github_project_owner: payload.githubProjectOwner,
    p_github_project_number: payload.githubProjectNumber,
    p_github_mention_team_slug: mentionTeamSlug || null,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });

  if (error) {
    if (error.code === "P0001") return apiError("Die GitHub-Project-Einstellung wurde parallel geändert. Bitte neu laden.", 409);
    if (error.code === "P0002") return apiError("FounderOps-Projekt wurde nicht gefunden.", 404);
    if (error.code === "42501") {
      return authzError(await resolveAdministratorAccessFailure(supabase));
    }
    if (error.code === "22023") return apiError("GitHub-Organisation oder Project-Nummer ist ungültig.", 400);
    return apiError("Die GitHub-Project-Einstellung konnte nicht gespeichert werden.", 500);
  }

  const result = data as GitHubProjectSettingsTransactionResult | null;
  const savedOwner = result?.project?.githubProjectOwner;
  const savedNumber = result?.project?.githubProjectNumber;
  const savedTeamSlug = result?.project?.githubMentionTeamSlug;
  if (!validGitHubProjectOwner(savedOwner) || !validGitHubProjectNumber(savedNumber) || (savedTeamSlug !== null && savedTeamSlug !== undefined && !validGitHubTeamSlug(savedTeamSlug))) {
    return apiError("Die GitHub-Project-Einstellung wurde unvollständig gespeichert.", 500);
  }

  return NextResponse.json({
    ok: true,
    project: {
      id: result?.project?.id || projectId,
      githubProjectOwner: savedOwner,
      githubProjectNumber: savedNumber,
      githubMentionTeamSlug: savedTeamSlug || "",
    },
    validation: {
      title: validation.title,
      url: validation.url,
      repositories: validation.repositories,
      fields: validation.fields,
    },
    mentionTeam,
  });
}
