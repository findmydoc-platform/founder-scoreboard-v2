import "server-only";

import { listGitHubIssueBlockedBy } from "../github";
import { githubGraphql } from "../github-graphql";
import {
  normalizeGitHubRepository,
  splitGitHubRepository,
} from "../github-repositories";

type SubIssueParentData = Readonly<{
  repository?: Readonly<{
    issue?: Readonly<{
      id: string;
      number: number;
      repository: Readonly<{ nameWithOwner: string }>;
      parent?: Readonly<{
        number: number;
        repository: Readonly<{ nameWithOwner: string }>;
      }> | null;
    }> | null;
  }> | null;
}>;

export type GitHubSubIssueParentObservation = Readonly<{
  repositoryFullName: string;
  issueNumber: number;
}> | null;

const subIssueParentQuery = `query FounderOpsInboundSubIssueParent(
  $owner: String!,
  $repo: String!,
  $number: Int!
) {
  repository(owner: $owner, name: $repo) {
    issue(number: $number) {
      id
      number
      repository { nameWithOwner }
      parent { number repository { nameWithOwner } }
    }
  }
}`;

export async function loadGitHubSubIssueParentObservation({
  childRepositoryFullName,
  childIssueNumber,
  childIssueNodeId,
  token,
}: {
  childRepositoryFullName: string;
  childIssueNumber: number;
  childIssueNodeId: string;
  token: string;
}): Promise<GitHubSubIssueParentObservation> {
  const childRepository = splitGitHubRepository(childRepositoryFullName);
  const data = await githubGraphql<SubIssueParentData>({
    query: subIssueParentQuery,
    variables: {
      owner: childRepository.owner,
      repo: childRepository.repo,
      number: childIssueNumber,
    },
    token,
    operation: "read",
    errorMessage: "GitHub Sub-Issue-Beziehung konnte nicht gelesen werden",
    missingDataMessage: "GitHub Sub-Issue-Beziehung lieferte keine Daten.",
  });
  const child = data.repository?.issue;
  if (
    !child
    || child.id !== childIssueNodeId
    || child.number !== childIssueNumber
    || normalizeGitHubRepository(child.repository.nameWithOwner) !== childRepository.repository
  ) {
    throw new Error("GitHub Sub-Issue identity does not match the verified delivery.");
  }
  if (!child.parent) return null;
  const parentRepository = normalizeGitHubRepository(child.parent.repository.nameWithOwner);
  if (!parentRepository || !Number.isSafeInteger(child.parent.number) || child.parent.number < 1) return null;
  return {
    repositoryFullName: parentRepository,
    issueNumber: child.parent.number,
  };
}

export async function loadGitHubDependencyObservation({
  blockedRepositoryFullName,
  blockedIssueNumber,
  blockingRepositoryFullName,
  blockingIssueNumber,
  token,
}: {
  blockedRepositoryFullName: string;
  blockedIssueNumber: number;
  blockingRepositoryFullName: string;
  blockingIssueNumber: number;
  token: string;
}) {
  const blockedRepository = splitGitHubRepository(blockedRepositoryFullName);
  const blockingRepository = splitGitHubRepository(blockingRepositoryFullName);
  const dependencies = await listGitHubIssueBlockedBy(
    blockedIssueNumber,
    token,
    blockedRepository.repository,
  );
  return dependencies.some((dependency) => (
    dependency.number === blockingIssueNumber
    && dependency.repositoryFullName === blockingRepository.repository
  ));
}
