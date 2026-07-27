import { githubGraphql } from "./github-graphql";
import {
  FOUNDEROPS_GITHUB_PROJECT_FIELDS,
  FOUNDEROPS_GITHUB_REPOSITORIES,
  validGitHubProjectNumber,
  validGitHubProjectOwner,
} from "./github-project-config";

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

  const data = await githubGraphql<ProjectValidationData>({
    query: projectValidationQuery,
    variables: { owner, number },
    token,
    operation: "read",
    errorMessage: "GitHub Project konnte nicht gelesen werden",
    missingDataMessage: "GitHub Project lieferte keine Daten.",
  });
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
