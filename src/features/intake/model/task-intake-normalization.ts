import { cleanText } from "@/lib/api-input";
import { normalizeLookup, slugify } from "@/lib/slug";
import type { TaskIntakeInput } from "@/features/intake/model/task-intake";
import {
  TEAM_TASK_INTAKE_INPUT_RULES,
  type TeamTaskIntakeInputKey,
} from "@/features/intake/model/team-task-intake-contract";

export type IntakeLookupProfile = {
  id: string;
  name: string;
  githubLogin?: string;
};

const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);

export function intakeText(value: unknown, maxLength: number) {
  if (Array.isArray(value)) {
    return cleanText(value.map((item) => `- ${String(item)}`).join("\n"), maxLength);
  }
  return cleanText(typeof value === "string" || typeof value === "number" ? String(value) : "", maxLength);
}

export function intakeDate(value: unknown) {
  const text = intakeText(value, 20);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? text
    : "";
}

export function intakePriority(value: unknown) {
  const priority = intakeText(value, 10);
  return priorities.has(priority) ? priority : "P2";
}

export function intakeHours(value: unknown) {
  const hours = Number(value || 0);
  if (!Number.isFinite(hours)) return 0;
  return Math.max(0, Math.min(200, Math.round(hours)));
}

export function validateTeamTaskIntakeField(key: TeamTaskIntakeInputKey, value: unknown) {
  const rule = TEAM_TASK_INTAKE_INPUT_RULES[key];
  if (value === undefined) return "required" in rule && rule.required ? "ist erforderlich" : "";

  if (rule.kind === "string") {
    if (typeof value !== "string") return "muss Text sein";
    if ("minLength" in rule && value.trim().length < rule.minLength) return `muss mindestens ${rule.minLength} Zeichen enthalten`;
    if (value.length > rule.maxLength) return `darf höchstens ${rule.maxLength} Zeichen enthalten`;
    return "";
  }
  if (rule.kind === "string-or-string-array") {
    if (typeof value === "string") return value.length <= rule.maxLength ? "" : `darf höchstens ${rule.maxLength} Zeichen enthalten`;
    if (Array.isArray(value) && value.every((item) => typeof item === "string")) return "";
    return "muss Text oder eine Liste aus Texten sein";
  }
  if (rule.kind === "enum") {
    return typeof value === "string" && (rule.values as readonly string[]).includes(value)
      ? ""
      : `muss einer der Werte ${rule.values.join(", ")} sein`;
  }
  if (rule.kind === "date") {
    return typeof value === "string" && value.length > 0 && intakeDate(value) === value
      ? ""
      : "muss ein gültiges Datum im Format YYYY-MM-DD sein";
  }
  return typeof value === "number" && Number.isFinite(value) && value >= rule.minimum && value <= rule.maximum
    ? ""
    : `muss eine Zahl zwischen ${rule.minimum} und ${rule.maximum} sein`;
}

export function intakeProfileByValue<T extends IntakeLookupProfile>(profiles: T[], value: string) {
  const normalized = normalizeLookup(value);
  const slug = slugify(value);
  return profiles.find((profile) => (
    normalizeLookup(profile.id) === normalized
    || normalizeLookup(profile.name) === normalized
    || normalizeLookup(profile.githubLogin || "") === normalized
    || normalizeLookup(profile.id) === slug
  )) || null;
}

export function normalizeTaskIntakeBrief(rawTask: TaskIntakeInput) {
  return {
    title: intakeText(rawTask.title, 240),
    description: intakeText(rawTask.description, 4000),
    problemStatement: intakeText(rawTask.problemStatement, 4000),
    intendedOutcome: intakeText(rawTask.intendedOutcome, 4000),
    scopeConstraints: intakeText(rawTask.scopeConstraints, 4000),
    acceptanceCriteria: intakeText(rawTask.acceptanceCriteria, 6000),
    evidenceRequired: intakeText(rawTask.evidenceRequired, 4000),
    definitionOfDone: intakeText(rawTask.definitionOfDone, 4000),
  };
}
