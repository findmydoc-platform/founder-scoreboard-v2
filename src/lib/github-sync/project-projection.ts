import type { SupabaseClient } from "@supabase/supabase-js";
import { githubGraphql } from "../github-graphql";
import {
  validGitHubProjectNumber,
  validGitHubProjectOwner,
} from "../github-project-config";
import { splitGitHubRepository } from "../github-repositories";
import type { Task } from "../types";

type ProjectField = {
  id: string;
  name: string;
  dataType: string;
  options?: Array<{ id: string; name: string }>;
  configuration?: {
    iterations: Array<{ id: string; title: string; startDate: string }>;
    completedIterations: Array<{ id: string; title: string; startDate: string }>;
  };
};

type IssueField = {
  id: string;
  name: string;
  dataType: string;
  options?: Array<{ id: string; name: string }>;
};

type ProjectItemFieldValue = {
  field?: { id: string; name: string } | null;
  text?: string | null;
  number?: number | null;
  date?: string | null;
  optionId?: string | null;
  iterationId?: string | null;
};

type IssueFieldValue = {
  field?: { name: string } | null;
  optionId?: string | null;
  value?: string | null;
};

type FieldContextData = {
  organization?: {
    projectV2?: {
      id: string;
      closed: boolean;
      fields: { nodes: Array<ProjectField | null> };
    } | null;
    issueFields: { nodes: Array<IssueField | null> };
  } | null;
  node?: {
    id: string;
    project: { id: string };
    content?: {
      id: string;
      issueFieldValues: { nodes: Array<IssueFieldValue | null> };
    } | null;
    fieldValues: { nodes: Array<ProjectItemFieldValue | null> };
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
  task: Pick<Task, "deadline" | "evidenceLink" | "hours" | "priority" | "startDate" | "status" | "taskType" | "workstream">;
  token: string;
};

const statusOptions: Record<string, string> = {
  Offen: "Todo",
  "In Arbeit": "In Progress",
  Review: "Review",
  Nacharbeit: "Changes Requested",
  Blockiert: "Blocked",
  Erledigt: "Done",
};

const priorityOptions: Record<string, string> = {
  P0: "Urgent",
  P1: "High",
  P2: "Medium",
  P3: "Low",
  P4: "Low",
};

function githubProjectStatusOption(status: string) {
  return statusOptions[status] || "";
}

function githubIssuePriorityOption(priority: string) {
  return priorityOptions[priority] || "";
}

const fieldContextQuery = `query FounderOpsProjectFields($owner: String!, $number: Int!, $itemId: ID!) {
  organization(login: $owner) {
    projectV2(number: $number) {
      id
      closed
      fields(first: 100) {
        nodes {
          __typename
          ... on ProjectV2Field { id name dataType }
          ... on ProjectV2SingleSelectField { id name dataType options { id name } }
          ... on ProjectV2IterationField {
            id
            name
            dataType
            configuration {
              iterations { id title startDate }
              completedIterations { id title startDate }
            }
          }
        }
      }
    }
    issueFields(first: 100) {
      nodes {
        __typename
        ... on IssueFieldCommon { name dataType }
        ... on IssueFieldSingleSelect { id options { id name } }
        ... on IssueFieldDate { id }
      }
    }
  }
  node(id: $itemId) {
    ... on ProjectV2Item {
      id
      project { id }
      content {
        ... on Issue {
          id
          issueFieldValues(first: 100) {
            nodes {
              __typename
              ... on IssueFieldSingleSelectValue {
                field { ... on IssueFieldCommon { name } }
                optionId
              }
              ... on IssueFieldDateValue {
                field { ... on IssueFieldCommon { name } }
                value
              }
            }
          }
        }
      }
      fieldValues(first: 100) {
        nodes {
          __typename
          ... on ProjectV2ItemFieldTextValue {
            field { ... on ProjectV2FieldCommon { id name } }
            text
          }
          ... on ProjectV2ItemFieldNumberValue {
            field { ... on ProjectV2FieldCommon { id name } }
            number
          }
          ... on ProjectV2ItemFieldDateValue {
            field { ... on ProjectV2FieldCommon { id name } }
            date
          }
          ... on ProjectV2ItemFieldSingleSelectValue {
            field { ... on ProjectV2FieldCommon { id name } }
            optionId
          }
          ... on ProjectV2ItemFieldIterationValue {
            field { ... on ProjectV2FieldCommon { id name } }
            iterationId
          }
        }
      }
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
    project.fields.nodes.filter((field): field is ProjectField => Boolean(field?.id && field.name)).map((field) => [field.name, field]),
  );
  const projectValues = new Map(
    item.fieldValues.nodes.filter((value): value is ProjectItemFieldValue => Boolean(value?.field?.name)).map((value) => [value.field!.name, value]),
  );
  const issueFields = new Map(
    (data.organization?.issueFields.nodes || []).filter((field): field is IssueField => Boolean(field?.id && field.name)).map((field) => [field.name, field]),
  );
  const issueValues = new Map(
    item.content.issueFieldValues.nodes.filter((value): value is IssueFieldValue => Boolean(value?.field?.name)).map((value) => [value.field!.name, value]),
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

  const startDate = input.task.startDate.trim();
  await reconcileIssue("Start date", "DATE", startDate ? { dateValue: startDate } : null, issueValues.get("Start date")?.value);
  const targetDate = input.task.deadline.trim();
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

async function loadGitHubProjectSettings(supabase: SupabaseClient) {
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
  if (existing) return { itemId: existing.id, projectId: project.id };

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
