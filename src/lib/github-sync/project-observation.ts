import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { githubGraphql } from "../github-graphql";
import { normalizeGitHubRepository } from "../github-repositories";
import {
  githubIssueFieldsSelection,
  githubIssueFieldValuesSelection,
  githubProjectFieldsSelection,
  githubProjectItemFieldValuesSelection,
  readGitHubIssueFieldValue,
  readGitHubProjectFieldValue,
  type GitHubIssueField,
  type GitHubIssueFieldValue,
  type GitHubPlanningFieldValue,
  type GitHubProjectField,
  type GitHubProjectItemFieldValue,
} from "./project-field-context";
import { loadFounderOpsGitHubProjectSettings } from "./project-projection";

type IssueContext = Readonly<{
  id: string;
  number: number;
  repository: Readonly<{ nameWithOwner: string }>;
  issueFieldValues: Readonly<{ nodes: readonly (GitHubIssueFieldValue | null)[] }>;
}>;

type ObservationData = Readonly<{
  organization?: Readonly<{
    projectV2?: Readonly<{
      id: string;
      closed: boolean;
      fields: Readonly<{ nodes: readonly (GitHubProjectField | null)[] }>;
    }> | null;
    issueFields: Readonly<{ nodes: readonly (GitHubIssueField | null)[] }>;
  }> | null;
  content?: IssueContext | null;
  item?: Readonly<{
    id: string;
    updatedAt: string;
    isArchived: boolean;
    project: Readonly<{ id: string }>;
    content?: Readonly<{ id: string }> | null;
    fieldValues: Readonly<{ nodes: readonly (GitHubProjectItemFieldValue | null)[] }>;
  }> | null;
}>;

type IssueFieldObservationData = Readonly<{
  organization?: Readonly<{
    issueFields: Readonly<{ nodes: readonly (GitHubIssueField | null)[] }>;
  }> | null;
  content?: IssueContext | null;
}>;

export type GitHubPlanningProjectObservation = Readonly<{
  repositoryFullName: string;
  issueNumber: number;
  projectNodeId: string;
  projectItemNodeId: string;
  projectItemActive: boolean;
  projectItemUpdatedAt: string | null;
  changedFieldName: string | null;
  changedFieldValue: GitHubPlanningFieldValue;
}>;

const projectObservationQuery = `query FounderOpsInboundProjectItem(
  $owner: String!,
  $number: Int!,
  $itemId: ID!,
  $contentId: ID!
) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      closed
      ${githubProjectFieldsSelection}
    }
    ${githubIssueFieldsSelection}
  }
  content: node(id: $contentId) {
    ... on Issue {
      id
      number
      repository { nameWithOwner }
      ${githubIssueFieldValuesSelection}
    }
  }
  item: node(id: $itemId) {
    ... on ProjectV2Item {
      id
      updatedAt
      isArchived
      project { id }
      content { ... on Issue { id } }
      ${githubProjectItemFieldValuesSelection}
    }
  }
}`;

const issueFieldObservationQuery = `query FounderOpsInboundIssueField(
  $owner: String!,
  $contentId: ID!
) {
  organization(login: $owner) {
    ${githubIssueFieldsSelection}
  }
  content: node(id: $contentId) {
    ... on Issue {
      id
      number
      repository { nameWithOwner }
      ${githubIssueFieldValuesSelection}
    }
  }
}`;

export async function loadGitHubPlanningProjectObservation({
  supabase,
  projectNodeId,
  projectItemNodeId,
  contentNodeId,
  fieldNodeId,
  token,
}: {
  supabase: SupabaseClient;
  projectNodeId: string;
  projectItemNodeId: string;
  contentNodeId: string;
  fieldNodeId: string | null;
  token: string;
}): Promise<GitHubPlanningProjectObservation> {
  const settings = await loadFounderOpsGitHubProjectSettings(supabase);
  const data = await githubGraphql<ObservationData>({
    query: projectObservationQuery,
    variables: {
      owner: settings.owner,
      number: settings.number,
      itemId: projectItemNodeId,
      contentId: contentNodeId,
    },
    token,
    operation: "read",
    errorMessage: "GitHub Project-Änderung konnte nicht gelesen werden",
    missingDataMessage: "GitHub Project-Änderung lieferte keine Daten.",
  });

  const project = data.organization?.projectV2;
  const issue = data.content;
  if (!project || project.closed || project.id !== projectNodeId) {
    throw new Error("GitHub Project identity does not match the configured FounderOps Project.");
  }
  if (!issue || issue.id !== contentNodeId || !Number.isSafeInteger(issue.number) || issue.number < 1) {
    throw new Error("GitHub Project content is not an Issue with the verified identity.");
  }
  const repositoryFullName = normalizeGitHubRepository(issue.repository.nameWithOwner);
  if (!repositoryFullName) throw new Error("GitHub Project content repository is not allowed.");
  if (data.item && (
    data.item.id !== projectItemNodeId
    || data.item.project.id !== project.id
    || data.item.content?.id !== issue.id
    || !data.item.updatedAt
    || Number.isNaN(Date.parse(data.item.updatedAt))
  )) {
    throw new Error("GitHub Project item identity does not match the verified delivery.");
  }

  const projectFields = project.fields.nodes.filter((field): field is GitHubProjectField => Boolean(field?.id && field.name));
  const issueFields = (data.organization?.issueFields.nodes || []).filter((field): field is GitHubIssueField => Boolean(field?.id && field.name));
  const projectField = fieldNodeId ? projectFields.find((field) => field.id === fieldNodeId) : undefined;
  const issueField = fieldNodeId ? issueFields.find((field) => field.id === fieldNodeId) : undefined;
  const projectValues = (data.item?.fieldValues.nodes || []).filter((value): value is GitHubProjectItemFieldValue => Boolean(value?.field?.id));
  const issueValues = issue.issueFieldValues.nodes.filter((value): value is GitHubIssueFieldValue => Boolean(value?.field?.name));
  const changedFieldName = projectField?.name || issueField?.name || null;
  const changedFieldValue = projectField
    ? readGitHubProjectFieldValue(projectField, projectValues.find((value) => value.field?.id === projectField.id))
    : issueField
      ? readGitHubIssueFieldValue(issueField, issueValues.find((value) => value.field?.name === issueField.name))
      : null;

  return {
    repositoryFullName,
    issueNumber: issue.number,
    projectNodeId: project.id,
    projectItemNodeId,
    projectItemActive: Boolean(data.item && !data.item.isArchived),
    projectItemUpdatedAt: data.item?.updatedAt || null,
    changedFieldName,
    changedFieldValue,
  };
}

export async function loadGitHubPlanningIssueFieldObservation({
  supabase,
  repositoryFullName,
  issueNumber,
  issueNodeId,
  fieldName,
  token,
}: {
  supabase: SupabaseClient;
  repositoryFullName: string;
  issueNumber: number;
  issueNodeId: string;
  fieldName: string;
  token: string;
}): Promise<Readonly<{
  fieldName: string;
  fieldValue: GitHubPlanningProjectObservation["changedFieldValue"];
}>> {
  const settings = await loadFounderOpsGitHubProjectSettings(supabase);
  const data = await githubGraphql<IssueFieldObservationData>({
    query: issueFieldObservationQuery,
    variables: { owner: settings.owner, contentId: issueNodeId },
    token,
    operation: "read",
    errorMessage: "GitHub Issue-Feldänderung konnte nicht gelesen werden",
    missingDataMessage: "GitHub Issue-Feldänderung lieferte keine Daten.",
  });
  const issue = data.content;
  const expectedRepository = normalizeGitHubRepository(repositoryFullName);
  if (
    !issue
    || issue.id !== issueNodeId
    || issue.number !== issueNumber
    || !expectedRepository
    || normalizeGitHubRepository(issue.repository.nameWithOwner) !== expectedRepository
  ) {
    throw new Error("GitHub Issue field identity does not match the verified delivery.");
  }
  const field = (data.organization?.issueFields.nodes || [])
    .filter((candidate): candidate is GitHubIssueField => Boolean(candidate?.id && candidate.name))
    .find((candidate) => candidate.name === fieldName);
  if (!field) throw new Error(`GitHub Issue field ${fieldName} is not accessible.`);
  const values = issue.issueFieldValues.nodes
    .filter((value): value is GitHubIssueFieldValue => Boolean(value?.field?.name));
  return {
    fieldName: field.name,
    fieldValue: readGitHubIssueFieldValue(field, values.find((value) => value.field?.name === field.name)),
  };
}
