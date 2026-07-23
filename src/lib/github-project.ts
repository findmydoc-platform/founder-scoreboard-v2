import { githubJson } from "./github-http";
import {
  FOUNDEROPS_GITHUB_PROJECT_FIELDS,
  FOUNDEROPS_GITHUB_REPOSITORIES,
  validGitHubProjectNumber,
  validGitHubProjectOwner,
} from "./github-project-config";
import { splitGitHubRepository } from "./github-repositories";

type GraphQLError = { message?: string };
type GraphQLResult<T> = { data?: T; errors?: GraphQLError[] };

type ProjectField = {
  name: string;
  dataType: string;
};

type ProjectValidationData = {
  organization?: {
    projectV2?: {
      id: string;
      number: number;
      title: string;
      closed: boolean;
      url: string;
      repositories: {
        nodes: Array<{ nameWithOwner: string }>;
        totalCount: number;
      };
      fields: {
        nodes: Array<ProjectField | null>;
      };
    } | null;
  } | null;
};

export type GitHubProjectValidation = {
  id: string;
  number: number;
  owner: string;
  title: string;
  url: string;
  repositories: string[];
  fields: ProjectField[];
};

function graphQLErrorMessage(errors?: GraphQLError[]) {
  return (errors || []).map((error) => error.message?.trim()).filter(Boolean).join(" | ");
}

async function githubGraphql<T>(query: string, variables: Record<string, unknown>, token: string, operation: "read" | "mutation") {
  const result = await githubJson<GraphQLResult<T>>("https://api.github.com/graphql", {
    token,
    method: "POST",
    operation,
    body: { query, variables },
    cache: "no-store",
    errorMessage: operation === "read" ? "GitHub Project konnte nicht gelesen werden" : "GitHub Project konnte nicht aktualisiert werden",
  });
  const message = graphQLErrorMessage(result.errors);
  if (message) throw new Error(message);
  if (!result.data) throw new Error("GitHub Project lieferte keine Daten.");
  return result.data;
}

const projectValidationQuery = `query FounderOpsProjectValidation($owner: String!, $number: Int!) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      number
      title
      closed
      url
      repositories(first: 100) {
        totalCount
        nodes { nameWithOwner }
      }
      fields(first: 100) {
        nodes {
          ... on ProjectV2FieldCommon { name dataType }
        }
      }
    }
  }
}`;

export async function validateFounderOpsGitHubProject(owner: string, number: number, token: string): Promise<GitHubProjectValidation> {
  if (!validGitHubProjectOwner(owner) || !validGitHubProjectNumber(number)) {
    throw new Error("GitHub-Organisation oder Project-Nummer ist ungültig.");
  }

  const data = await githubGraphql<ProjectValidationData>(projectValidationQuery, { owner, number }, token, "read");
  if (!data.organization) throw new Error(`GitHub-Organisation ${owner} wurde nicht gefunden oder ist für die App nicht erreichbar.`);
  const project = data.organization.projectV2;
  if (!project) throw new Error(`GitHub Project ${owner}#${number} wurde nicht gefunden oder ist für die App nicht erreichbar.`);
  if (project.closed) throw new Error(`GitHub Project ${owner}#${number} ist geschlossen.`);

  const repositories = project.repositories.nodes.map((repository) => repository.nameWithOwner);
  const repositorySet = new Set(repositories.map((repository) => repository.toLowerCase()));
  const missingRepositories = FOUNDEROPS_GITHUB_REPOSITORIES.filter((repository) => !repositorySet.has(repository.toLowerCase()));
  if (missingRepositories.length) {
    throw new Error(`Im GitHub Project fehlen Repository-Verknüpfungen: ${missingRepositories.join(", ")}.`);
  }

  const fields = project.fields.nodes.filter((field): field is ProjectField => Boolean(field?.name && field.dataType));
  const missingFields = FOUNDEROPS_GITHUB_PROJECT_FIELDS.filter((expected) => (
    !fields.some((field) => field.name === expected.name && field.dataType === expected.dataType)
  ));
  if (missingFields.length) {
    throw new Error(`Im GitHub Project fehlen erwartete Felder: ${missingFields.map((field) => `${field.name} (${field.dataType})`).join(", ")}.`);
  }

  return {
    id: project.id,
    number: project.number,
    owner,
    title: project.title,
    url: project.url,
    repositories,
    fields,
  };
}

type ProjectMembershipData = {
  organization?: {
    projectV2?: { id: string; closed: boolean } | null;
  } | null;
  repository?: {
    issue?: {
      id: string;
      projectItems: {
        nodes: Array<{ id: string; project: { id: string } }>;
      };
    } | null;
  } | null;
};

const projectMembershipQuery = `query FounderOpsProjectMembership(
  $projectOwner: String!,
  $projectNumber: Int!,
  $repositoryOwner: String!,
  $repositoryName: String!,
  $issueNumber: Int!
) {
  organization(login: $projectOwner) {
    projectV2(number: $projectNumber) { id closed }
  }
  repository(owner: $repositoryOwner, name: $repositoryName) {
    issue(number: $issueNumber) {
      id
      projectItems(first: 100) {
        nodes { id project { id } }
      }
    }
  }
}`;

const addProjectItemMutation = `mutation FounderOpsAddProjectItem($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item { id }
  }
}`;

type FounderOpsGitHubProjectItemInput = {
  issueNumber: number;
  projectNumber: number;
  projectOwner: string;
  repository: string;
  token: string;
};

export async function observeFounderOpsGitHubProjectItem({
  issueNumber,
  projectNumber,
  projectOwner,
  repository,
  token,
}: FounderOpsGitHubProjectItemInput) {
  if (!validGitHubProjectOwner(projectOwner) || !validGitHubProjectNumber(projectNumber)) {
    throw new Error("FounderOps GitHub-Project-Konfiguration fehlt oder ist ungültig.");
  }
  const { owner: repositoryOwner, repo: repositoryName } = splitGitHubRepository(repository);
  const data = await githubGraphql<ProjectMembershipData>(projectMembershipQuery, {
    projectOwner,
    projectNumber,
    repositoryOwner,
    repositoryName,
    issueNumber,
  }, token, "read");
  const project = data.organization?.projectV2;
  if (!project) throw new Error(`GitHub Project ${projectOwner}#${projectNumber} wurde nicht gefunden oder ist für die App nicht erreichbar.`);
  if (project.closed) throw new Error(`GitHub Project ${projectOwner}#${projectNumber} ist geschlossen.`);
  const issue = data.repository?.issue;
  if (!issue) throw new Error(`GitHub Issue ${repository}#${issueNumber} konnte für die Project-Aufnahme nicht gelesen werden.`);

  const existing = issue.projectItems.nodes.find((item) => item.project.id === project.id);
  return {
    issueId: issue.id,
    itemId: existing?.id || null,
    projectId: project.id,
  };
}

export async function ensureFounderOpsGitHubProjectItem(input: FounderOpsGitHubProjectItemInput) {
  const observed = await observeFounderOpsGitHubProjectItem(input);
  if (observed.itemId) return { added: false, itemId: observed.itemId, projectId: observed.projectId };

  const mutation = await githubGraphql<{
    addProjectV2ItemById?: { item?: { id: string } | null } | null;
  }>(addProjectItemMutation, {
    projectId: observed.projectId,
    contentId: observed.issueId,
  }, input.token, "mutation");
  const itemId = mutation.addProjectV2ItemById?.item?.id;
  if (!itemId) {
    throw new Error(
      `GitHub Issue ${input.repository}#${input.issueNumber} wurde nicht in Project ${input.projectOwner}#${input.projectNumber} aufgenommen.`,
    );
  }
  return { added: true, itemId, projectId: observed.projectId };
}
