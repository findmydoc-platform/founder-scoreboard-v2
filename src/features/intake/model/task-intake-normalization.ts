import { cleanText } from "@/lib/api-input";
import { normalizeLookup, slugify } from "@/lib/slug";
import type { TaskIntakeInput } from "@/features/intake/model/task-intake";

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
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function intakePriority(value: unknown) {
  const priority = intakeText(value, 10);
  return priorities.has(priority) ? priority : "P2";
}

export function intakeHours(value: unknown) {
  return Math.max(0, Math.min(200, Math.round(Number(value || 0))));
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
