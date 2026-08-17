export type GitHubProjectField = Readonly<{
  id: string;
  name: string;
  dataType: string;
  options?: readonly Readonly<{ id: string; name: string }>[];
  configuration?: Readonly<{
    iterations: readonly Readonly<{ id: string; title: string; startDate: string }>[];
    completedIterations: readonly Readonly<{ id: string; title: string; startDate: string }>[];
  }>;
}>;

export type GitHubIssueField = Readonly<{
  id: string;
  name: string;
  dataType: string;
  options?: readonly Readonly<{ id: string; name: string }>[];
}>;

export type GitHubProjectItemFieldValue = Readonly<{
  field?: Readonly<{ id: string; name: string }> | null;
  text?: string | null;
  number?: number | null;
  date?: string | null;
  optionId?: string | null;
  iterationId?: string | null;
}>;

export type GitHubIssueFieldValue = Readonly<{
  field?: Readonly<{ name: string }> | null;
  optionId?: string | null;
  value?: string | null;
}>;

export type GitHubPlanningFieldValue =
  | string
  | number
  | Readonly<{ title: string; startDate: string }>
  | null;

export const githubProjectFieldsSelection = `fields(first: 100) {
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
}`;

export const githubIssueFieldsSelection = `issueFields(first: 100) {
  nodes {
    __typename
    ... on IssueFieldCommon { name dataType }
    ... on IssueFieldSingleSelect { id options { id name } }
    ... on IssueFieldDate { id }
  }
}`;

export const githubIssueFieldValuesSelection = `issueFieldValues(first: 100) {
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
}`;

export const githubProjectItemFieldValuesSelection = `fieldValues(first: 100) {
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
}`;

const githubStatusByFounderOpsStatus: Readonly<Record<string, string>> = {
  Offen: "Todo",
  "In Arbeit": "In Progress",
  Review: "Review",
  Nacharbeit: "Changes Requested",
  Blockiert: "Blocked",
  Erledigt: "Done",
};

const githubPriorityByFounderOpsPriority: Readonly<Record<string, string>> = {
  P0: "Urgent",
  P1: "High",
  P2: "Medium",
  P3: "Low",
  P4: "Low",
};

function uniqueFounderOpsValue(mapping: Readonly<Record<string, string>>, githubValue: string) {
  const matches = Object.entries(mapping)
    .filter(([, value]) => value === githubValue)
    .map(([key]) => key);
  return matches.length === 1 ? matches[0] : null;
}

export function githubProjectStatusOption(status: string) {
  return githubStatusByFounderOpsStatus[status] || "";
}

export function githubProjectStatusToFounderOps(value: string) {
  return uniqueFounderOpsValue(githubStatusByFounderOpsStatus, value);
}

export function githubIssuePriorityOption(priority: string) {
  return githubPriorityByFounderOpsPriority[priority] || "";
}

export function githubIssuePriorityToFounderOps(value: string) {
  return uniqueFounderOpsValue(githubPriorityByFounderOpsPriority, value);
}

export function readGitHubProjectFieldValue(
  field: GitHubProjectField,
  value: GitHubProjectItemFieldValue | undefined,
): GitHubPlanningFieldValue {
  if (!value) return null;
  if (field.dataType === "SINGLE_SELECT") {
    return field.options?.find((option) => option.id === value.optionId)?.name || null;
  }
  if (field.dataType === "ITERATION") {
    const iterations = [
      ...(field.configuration?.iterations || []),
      ...(field.configuration?.completedIterations || []),
    ];
    const iteration = iterations.find((candidate) => candidate.id === value.iterationId);
    return iteration ? { title: iteration.title, startDate: iteration.startDate } : null;
  }
  if (field.dataType === "NUMBER") return typeof value.number === "number" ? value.number : null;
  if (field.dataType === "DATE") return value.date || null;
  if (field.dataType === "TEXT") return value.text || null;
  return null;
}

export function readGitHubIssueFieldValue(
  field: GitHubIssueField,
  value: GitHubIssueFieldValue | undefined,
): GitHubPlanningFieldValue {
  if (!value) return null;
  if (field.dataType === "SINGLE_SELECT") {
    return field.options?.find((option) => option.id === value.optionId)?.name || null;
  }
  if (field.dataType === "DATE") return value.value || null;
  return null;
}
