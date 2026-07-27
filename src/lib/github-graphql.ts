import { githubJson, type GitHubOperationKind } from "./github-http";

type GraphQLError = {
  message?: string | null;
};

type GraphQLResult<T> = {
  data?: T | null;
  errors?: GraphQLError[] | null;
};

export type GitHubGraphqlInput = {
  query: string;
  variables?: Record<string, unknown>;
  token: string;
  operation: GitHubOperationKind;
  errorMessage: string;
  missingDataMessage?: string;
};

export async function githubGraphql<T>({
  query,
  variables = {},
  token,
  operation,
  errorMessage,
  missingDataMessage = "GitHub GraphQL lieferte keine Daten.",
}: GitHubGraphqlInput): Promise<T> {
  const result = await githubJson<GraphQLResult<T>>("https://api.github.com/graphql", {
    token,
    method: "POST",
    operation,
    body: { query, variables },
    cache: "no-store",
    errorMessage,
  });
  const message = (result.errors || [])
    .map((error) => error.message?.trim())
    .filter(Boolean)
    .join(" | ");
  if (message) throw new Error(message);
  if (result.data === undefined || result.data === null) throw new Error(missingDataMessage);
  return result.data;
}
