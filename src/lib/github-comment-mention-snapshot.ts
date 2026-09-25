import { githubMentionContext, normalizeGitHubMentionsForFounderOps, type MentionTeam } from "@/lib/mentions";

export type GitHubMentionProfile = {
  id: string;
  name?: string | null;
  githubLogin?: string | null;
};

export type ExistingGitHubCommentMentionSnapshot = {
  authorLogin: string;
  body: string;
  sourceUpdatedAt: string;
  mentionRecipientProfileIds: string[];
  mentionRecipientsInitialized: boolean;
};

export function resolveGitHubCommentMentionSnapshot({
  authorLogin,
  body,
  existing,
  profiles,
  team,
}: {
  authorLogin: string;
  body: string;
  existing?: ExistingGitHubCommentMentionSnapshot;
  profiles: GitHubMentionProfile[];
  team?: MentionTeam;
}) {
  const normalizedBody = normalizeGitHubMentionsForFounderOps(body, team);
  const current = githubMentionContext(normalizedBody, profiles, authorLogin);
  if (!existing || existing.mentionRecipientsInitialized) {
    return {
      actorProfileId: current.actorProfileId,
      mentionRecipientProfileIds: current.recipientProfileIds,
      baselineMentionRecipientProfileIds: [] as string[],
      baselineSourceUpdatedAt: null as string | null,
      normalizedBody,
    };
  }

  const baseline = githubMentionContext(existing.body, profiles, existing.authorLogin, team);
  return {
    actorProfileId: current.actorProfileId,
    mentionRecipientProfileIds: current.recipientProfileIds,
    baselineMentionRecipientProfileIds: baseline.recipientProfileIds,
    baselineSourceUpdatedAt: existing.sourceUpdatedAt,
    normalizedBody,
  };
}
