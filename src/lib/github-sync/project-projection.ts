import type { SupabaseClient } from "@supabase/supabase-js";
import { githubGraphql } from "../github-graphql";
import {
  validGitHubProjectNumber,
  validGitHubProjectOwner,
} from "../github-project-config";
import { splitGitHubRepository } from "../github-repositories";
import type { Task } from "../types";
import {
  githubIssueFieldsSelection,
  githubIssueFieldValuesSelection,
  githubIssuePriorityOption,
  githubProjectFieldsSelection,
  githubProjectItemFieldValuesSelection,
  githubProjectStatusOption,
  type GitHubIssueField,
  type GitHubIssueFieldValue,
  type GitHubProjectField,
  type GitHubProjectItemFieldValue,
} from "./project-field-context";

type FieldContextData = {
  organization?: {
    projectV2?: {
      id: string;
      closed: boolean;
      fields: { nodes: Array<GitHubProjectField | null> };
    } | null;
    issueFields: { nodes: Array<GitHubIssueField | null> };
  } | null;
  node?: {
    id: string;
    project: { id: string };
    content?: {
      id: string;
      issueFieldValues: { nodes: Array<GitHubIssueFieldValue | null> };
    } | null;
    fieldValues: { nodes: Array<GitHubProjectItemFieldValue | null> };
  } | null;
};

type FounderOpsGitHubSprint = {
  title: string;
  startDate: string;
};

type FounderOpsGitHubProjectFieldInput = {
  dryRun?: boolean;
  itemId: string;
  projectId: string;
  projectNumber: number;
  projectOwner: string;
  sprint?: FounderOpsGitHubSprint | null;
  task: Pick<Task, "fixedDate" | "evidenceLink" | "hours" | "priority" | "status" | "taskType" | "workstream">;
  token: string;
};

const fieldContextQuery = `query FounderOpsProjectFields($owner: String!, $number: Int!, $itemId: ID!) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      closed
      ${githubProjectFieldsSelection}
    }
    ${githubIssueFieldsSelection}
  }
  node(id: $itemId) {
    ... on ProjectV2Item {
      id
      project { id }
      content {
        ... on Issue {
          id
          ${githubIssueFieldValuesSelection}
        }
      }
      ${githubProjectItemFieldValuesSelection}
    }
  }
}`;

const updateProjectFieldMutation = `mutation UpdateFounderOpsProjectField(
  $projectId: ID!,
  $itemId: ID!,
  $fieldId: ID!,
  $value: ProjectV2FieldValue!
) {
  updateProjectV2ItemFieldValue(input: {
    projectId: $projectId,
    itemId: $itemId,
    fieldId: $fieldId,
    value: $value
  }) { projectV2Item { id } }
}`;

const clearProjectFieldMutation = `mutation ClearFounderOpsProjectField($projectId: ID!, $itemId: ID!, $fieldId: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId }) {
    projectV2Item { id }
  }
}`;

const setIssueFieldMutation = `mutation SetFounderOpsIssueField($issueId: ID!, $issueFields: [IssueFieldCreateOrUpdateInput!]!) {
  setIssueFieldValue(input: { issueId: $issueId, issueFields: $issueFields }) { issue { id } }
}`;

function sameCaseInsensitive(left: string, right: string) {
  return left.trim().localeCompare(right.trim(), undefined, { sensitivity: "accent" }) === 0;
}

function warningMessage(field: string, error: unknown) {
  const message = error instanceof Error ? error.message : "unbekannter Fehler";
  return `${field} konnte nicht synchronisiert werden: ${message}`;
}

async function syncFounderOpsGitHubProjectFields(input: FounderOpsGitHubProjectFieldInput) {
  const changes: string[] = [];
  const warnings: string[] = [];
  let data: FieldContextData;
  try {
    data = await githubGraphql<FieldContextData>({
      query: fieldContextQuery,
      variables: {
        owner: input.projectOwner,
        number: input.projectNumber,
        itemId: input.itemId,
      },
      token: input.token,
      operation: "read",
      errorMessage: "GitHub Project-Felder konnten nicht gelesen werden",
      missingDataMessage: "GitHub Project-Felder lieferten keine Daten.",
    });
  } catch (error) {
    return { changes, warnings: [warningMessage("GitHub Project-Felder", error)] };
  }

  const project = data.organization?.projectV2;
  const item = data.node;
  if (!project || project.closed || project.id !== input.projectId || !item || item.project.id !== project.id || !item.content?.id) {
    return {
      changes,
      warnings: ["GitHub Project-Felder konnten nicht synchronisiert werden: Project-Item oder Issue-Kontext ist nicht mehr erreichbar."],
    };
  }

  const projectFields = new Map(
    project.fields.nodes.filter((field): field is GitHubProjectField => Boolean(field?.id && field.name)).map((field) => [field.name, field]),
  );
  const projectValues = new Map(
    item.fieldValues.nodes.filter((value): value is GitHubProjectItemFieldValue => Boolean(value?.field?.name)).map((value) => [value.field!.name, value]),
  );
  const issueFields = new Map(
    (data.organization?.issueFields.nodes || []).filter((field): field is GitHubIssueField => Boolean(field?.id && field.name)).map((field) => [field.name, field]),
  );
  const issueValues = new Map(
    item.content.issueFieldValues.nodes.filter((value): value is GitHubIssueFieldValue => Boolean(value?.field?.name)).map((value) => [value.field!.name, value]),
  );

  const updateProjectField = async (fieldName: string, expectedType: string, value: Record<string, unknown> | null, current: unknown) => {
    const field = projectFields.get(fieldName);
    if (!field || field.dataType !== expectedType) throw new Error(`Feld ${fieldName} (${expectedType}) fehlt.`);
    if (value === null) {
      if (current === undefined || current === null || current === "") return;
      changes.push(fieldName);
      if (input.dryRun) return;
      await githubGraphql({
        query: clearProjectFieldMutation,
        variables: {
          projectId: project.id,
          itemId: item.id,
          fieldId: field.id,
        },
        token: input.token,
        operation: "mutation",
        errorMessage: "GitHub Project-Feld konnte nicht entfernt werden",
      });
      return;
    }
    const desired = Object.values(value)[0];
    if (current === desired) return;
    changes.push(fieldName);
    if (input.dryRun) return;
    await githubGraphql({
      query: updateProjectFieldMutation,
      variables: {
        projectId: project.id,
        itemId: item.id,
        fieldId: field.id,
        value,
      },
      token: input.token,
      operation: "mutation",
      errorMessage: "GitHub Project-Feld konnte nicht aktualisiert werden",
    });
  };

  const reconcileProject = async (fieldName: string, expectedType: string, value: Record<string, unknown> | null, current: unknown) => {
    try {
      await updateProjectField(fieldName, expectedType, value, current);
    } catch (error) {
      warnings.push(warningMessage(fieldName, error));
    }
  };

  const statusName = githubProjectStatusOption(input.task.status);
  if (!statusName) {
    warnings.push(`Status konnte nicht synchronisiert werden: Unbekannter FounderOps-Status ${input.task.status}.`);
  } else {
    const field = projectFields.get("Status");
    const option = field?.options?.find((candidate) => candidate.name === statusName);
    if (option) {
      await reconcileProject("Status", "SINGLE_SELECT", { singleSelectOptionId: option.id }, projectValues.get("Status")?.optionId);
    } else {
      warnings.push(`Status konnte nicht synchronisiert werden: Option ${statusName} fehlt.`);
    }
  }

  if (input.task.taskType === "sub_issue") {
    return { changes, warnings };
  }

  if (input.sprint !== undefined) {
    const field = projectFields.get("Sprint");
    const iterations = [...(field?.configuration?.iterations || []), ...(field?.configuration?.completedIterations || [])];
    const iteration = input.sprint
      ? iterations.find((candidate) => candidate.title === input.sprint?.title && candidate.startDate === input.sprint?.startDate)
      : null;
    await reconcileProject("Sprint", "ITERATION", iteration ? { iterationId: iteration.id } : null, projectValues.get("Sprint")?.iterationId);
    if (input.sprint && !iteration) {
      warnings.push(`Sprint konnte nicht synchronisiert werden: Keine Iteration für ${input.sprint.title} ab ${input.sprint.startDate}; alter Wert wurde entfernt.`);
    }
  }

  const workstreamName = input.task.workstream.trim();
  const workstreamField = projectFields.get("Workstream");
  const workstreamOption = workstreamName
    ? workstreamField?.options?.find((candidate) => sameCaseInsensitive(candidate.name, workstreamName))
    : null;
  await reconcileProject("Workstream", "SINGLE_SELECT", workstreamOption ? { singleSelectOptionId: workstreamOption.id } : null, projectValues.get("Workstream")?.optionId);
  if (workstreamName && !workstreamOption) {
    warnings.push(`Workstream konnte nicht synchronisiert werden: Option ${workstreamName} fehlt; alter Wert wurde entfernt.`);
  }

  await reconcileProject("Estimate hours", "NUMBER", { number: input.task.hours }, projectValues.get("Estimate hours")?.number);
  const evidenceUrl = input.task.evidenceLink.trim();
  await reconcileProject("Evidence URL", "TEXT", evidenceUrl ? { text: evidenceUrl } : null, projectValues.get("Evidence URL")?.text);

  const updateIssueField = async (fieldName: string, expectedType: string, value: Record<string, unknown> | null, current: unknown) => {
    const field = issueFields.get(fieldName);
    if (!field || field.dataType !== expectedType) throw new Error(`Issue Field ${fieldName} (${expectedType}) fehlt.`);
    const desired = value ? Object.values(value)[0] : null;
    if (value === null && (current === undefined || current === null || current === "")) return;
    if (value !== null && current === desired) return;
    changes.push(fieldName);
    if (input.dryRun) return;
    await githubGraphql({
      query: setIssueFieldMutation,
      variables: {
        issueId: item.content!.id,
        issueFields: [{ fieldId: field.id, ...(value || { delete: true }) }],
      },
      token: input.token,
      operation: "mutation",
      errorMessage: "GitHub Issue-Feld konnte nicht aktualisiert werden",
    });
  };

  const reconcileIssue = async (fieldName: string, expectedType: string, value: Record<string, unknown> | null, current: unknown) => {
    try {
      await updateIssueField(fieldName, expectedType, value, current);
    } catch (error) {
      warnings.push(warningMessage(fieldName, error));
    }
  };

  const priorityName = githubIssuePriorityOption(input.task.priority);
  if (!priorityName) {
    warnings.push(`Priority konnte nicht synchronisiert werden: Unbekannte FounderOps-Priorität ${input.task.priority}.`);
  } else {
    const field = issueFields.get("Priority");
    const option = field?.options?.find((candidate) => candidate.name === priorityName);
    if (option) {
      await reconcileIssue("Priority", "SINGLE_SELECT", { singleSelectOptionId: option.id }, issueValues.get("Priority")?.optionId);
    } else {
      warnings.push(`Priority konnte nicht synchronisiert werden: Option ${priorityName} fehlt.`);
    }
  }

  await reconcileIssue("Start date", "DATE", null, issueValues.get("Start date")?.value);
  const targetDate = input.task.fixedDate.trim();
  await reconcileIssue("Target date", "DATE", targetDate ? { dateValue: targetDate } : null, issueValues.get("Target date")?.value);

  return { changes, warnings };
}

const founderOpsProjectId = "findmydoc-founder-execution";

type ProjectMembershipData = {
  organization?: {
    projectV2?: { id: string; closed: boolean } | null;
  } | null;
  repository?: {
    issue?: {
      id: string;
      projectItems: {
        nodes: Array<{ id: string; isArchived: boolean; project: { id: string } }>;
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
        nodes { id isArchived project { id } }
      }
    }
  }
}`;

const addProjectItemMutation = `mutation FounderOpsAddProjectItem($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
    item { id }
  }
}`;

const unarchiveProjectItemMutation = `mutation FounderOpsUnarchiveProjectItem($projectId: ID!, $itemId: ID!) {
  unarchiveProjectV2Item(input: { projectId: $projectId, itemId: $itemId }) {
    item { id }
  }
}`;

export async function loadGitHubProjectSettings(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("projects")
    .select("github_project_owner,github_project_number")
    .eq("id", founderOpsProjectId)
    .single<{ github_project_owner: string | null; github_project_number: number | null }>();
  if (error || !data) throw new Error("FounderOps GitHub-Project-Konfiguration konnte nicht geladen werden.");
  if (!validGitHubProjectOwner(data.github_project_owner) || !validGitHubProjectNumber(data.github_project_number)) {
    throw new Error("FounderOps GitHub-Project-Konfiguration fehlt oder ist ungültig.");
  }
  return {
    owner: data.github_project_owner,
    number: data.github_project_number,
  };
}

export const loadFounderOpsGitHubProjectSettings = loadGitHubProjectSettings;

async function loadGitHubProjectSprint(supabase: SupabaseClient, sprintId: string) {
  if (!sprintId) return { sprint: null as FounderOpsGitHubSprint | null, warnings: [] as string[] };
  const { data, error } = await supabase
    .from("sprints")
    .select("name,start_date")
    .eq("id", sprintId)
    .maybeSingle<{ name: string | null; start_date: string | null }>();
  if (error || !data?.name || !data.start_date) {
    return {
      sprint: undefined,
      warnings: [`Sprint konnte nicht synchronisiert werden: FounderOps-Sprint ${sprintId} konnte nicht vollständig geladen werden.`],
    };
  }
  return {
    sprint: { title: data.name, startDate: data.start_date },
    warnings: [] as string[],
  };
}

async function ensureProjectMembership({
  issueNumber,
  projectNumber,
  projectOwner,
  repository,
  token,
}: {
  issueNumber: number;
  projectNumber: number;
  projectOwner: string;
  repository: string;
  token: string;
}) {
  const { owner: repositoryOwner, repo: repositoryName } = splitGitHubRepository(repository);
  const observed = await githubGraphql<ProjectMembershipData>({
    query: projectMembershipQuery,
    variables: {
      projectOwner,
      projectNumber,
      repositoryOwner,
      repositoryName,
      issueNumber,
    },
    token,
    operation: "read",
    errorMessage: "GitHub Project-Mitgliedschaft konnte nicht gelesen werden",
  });
  const project = observed.organization?.projectV2;
  if (!project) throw new Error(`GitHub Project ${projectOwner}#${projectNumber} wurde nicht gefunden oder ist für die App nicht erreichbar.`);
  if (project.closed) throw new Error(`GitHub Project ${projectOwner}#${projectNumber} ist geschlossen.`);
  const issue = observed.repository?.issue;
  if (!issue) throw new Error(`GitHub Issue ${repository}#${issueNumber} konnte für die Project-Aufnahme nicht gelesen werden.`);

  const existing = issue.projectItems.nodes.find((item) => item.project.id === project.id);
  if (existing) {
    if (existing.isArchived) {
      const unarchived = await githubGraphql<{
        unarchiveProjectV2Item?: { item?: { id: string } | null } | null;
      }>({
        query: unarchiveProjectItemMutation,
        variables: { projectId: project.id, itemId: existing.id },
        token,
        operation: "mutation",
        errorMessage: "GitHub Project-Mitgliedschaft konnte nicht wiederhergestellt werden",
      });
      if (unarchived.unarchiveProjectV2Item?.item?.id !== existing.id) {
        throw new Error(`GitHub Project-Item ${existing.id} wurde nicht wiederhergestellt.`);
      }
    }
    return { itemId: existing.id, projectId: project.id };
  }

  const mutation = await githubGraphql<{
    addProjectV2ItemById?: { item?: { id: string } | null } | null;
  }>({
    query: addProjectItemMutation,
    variables: { projectId: project.id, contentId: issue.id },
    token,
    operation: "mutation",
    errorMessage: "GitHub Project-Mitgliedschaft konnte nicht erstellt werden",
  });
  const itemId = mutation.addProjectV2ItemById?.item?.id;
  if (!itemId) {
    throw new Error(
      `GitHub Issue ${repository}#${issueNumber} wurde nicht in Project ${projectOwner}#${projectNumber} aufgenommen.`,
    );
  }
  return { itemId, projectId: project.id };
}

export async function projectTaskToFounderOpsGitHubProject({
  supabase,
  task,
  issueNumber,
  repository,
  token,
}: {
  supabase: SupabaseClient;
  task: Task;
  issueNumber: number;
  repository: string;
  token: string;
}) {
  const project = await loadGitHubProjectSettings(supabase);
  const item = await ensureProjectMembership({
    issueNumber,
    projectNumber: project.number,
    projectOwner: project.owner,
    repository,
    token,
  });
  const sprint = await loadGitHubProjectSprint(supabase, task.sprintId);
  const fields = await syncFounderOpsGitHubProjectFields({
    itemId: item.itemId,
    projectId: item.projectId,
    projectNumber: project.number,
    projectOwner: project.owner,
    sprint: sprint.sprint,
    task,
    token,
  }).catch((error) => ({
    changes: [],
    warnings: [`GitHub Project-Felder konnten nicht synchronisiert werden: ${error instanceof Error ? error.message : "unbekannter Fehler"}`],
  }));
  return {
    changes: fields.changes,
    warnings: [...sprint.warnings, ...fields.warnings],
  };
}
