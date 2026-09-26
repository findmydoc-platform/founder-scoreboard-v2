import {
  codepointLength,
  contentLengthError,
  renderGitHubIssueContent,
  validateGitHubIssueContent,
  type ContentLengthError,
  type IssueContentContext,
  type IssueContentTask,
} from "@/lib/github-issue-content";

import { PLANNING_LONG_TEXT_LIMIT, PLANNING_TITLE_LIMIT } from "./planning-content-limits";
const briefFieldLabels = {
  description: "Kontext",
  problemStatement: "Problem",
  intendedOutcome: "Zielbild",
  scopeConstraints: "Umfang & Grenzen",
  acceptanceCriteria: "Abnahmekriterien",
  evidenceRequired: "Erforderlicher Nachweis",
  definitionOfDone: "Qualitätsstandard",
} as const;

export function planningText(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

export function planningCriteria(value: unknown): string {
  return Array.isArray(value) ? value.map(planningText).filter(Boolean).join("\n") : planningText(value);
}

export function validatePlanningFields(task: IssueContentTask): ContentLengthError[] {
  const errors: ContentLengthError[] = [];
  const title = task.title.trim();
  const titleError = contentLengthError("title", title, PLANNING_TITLE_LIMIT, "Der Titel");
  if (titleError) errors.push(titleError);
  const titleLength = codepointLength(title);
  if (titleLength < 3) {
    errors.push({
      field: "title", actual: titleLength, maximum: PLANNING_TITLE_LIMIT, excess: 0,
      message: "Der Titel muss mindestens 3 Zeichen enthalten.",
    });
  }
  for (const [field, label] of Object.entries(briefFieldLabels)) {
    const value = task[field as keyof typeof briefFieldLabels]?.trim() || "";
    const error = contentLengthError(field, value, PLANNING_LONG_TEXT_LIMIT, `Das Feld "${label}"`);
    if (error) errors.push(error);
  }
  return errors;
}

export function validatePlanningContent(task: IssueContentTask, context: IssueContentContext = {}): ContentLengthError[] {
  const errors = validatePlanningFields(task);
  if (task.taskType === "deliverable" || task.taskType === "sub_issue") {
    errors.push(...validateGitHubIssueContent(renderGitHubIssueContent(task, context)));
  }
  return errors;
}

export function planningContentFromRow(row: Record<string, unknown>): IssueContentTask {
  return {
    id: String(row.id || ""),
    title: String(row.title || ""),
    taskType: row.task_type as IssueContentTask["taskType"],
    description: String(row.description || ""),
    problemStatement: String(row.problem_statement || ""),
    intendedOutcome: String(row.intended_outcome || ""),
    scopeConstraints: String(row.scope_constraints || ""),
    acceptanceCriteria: String(row.acceptance_criteria || ""),
    evidenceRequired: String(row.evidence_required || ""),
    definitionOfDone: String(row.definition_of_done || ""),
    evidenceLink: String(row.evidence_link || ""),
  };
}
