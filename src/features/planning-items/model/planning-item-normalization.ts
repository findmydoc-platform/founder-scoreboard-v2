import { cleanText } from "@/lib/api-input";
import { normalizeLookup, slugify } from "@/lib/slug";
import type { TaskIntakeInput } from "@/features/intake/model/task-intake";
import {
  PLANNING_ITEM_FIELD_RULES,
  TEAM_PLANNING_MILESTONE_STATUSES,
  type PlanningItemFieldKey,
} from "@/features/planning-items/model/planning-items-contract";

export type IntakeLookupProfile = {
  id: string;
  name: string;
  githubLogin?: string;
};

const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);
const milestoneStatuses = new Set<string>(TEAM_PLANNING_MILESTONE_STATUSES);

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

export function intakeStringList(value: unknown, maxLength = 120) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => intakeText(entry, maxLength)).filter(Boolean))]
    : [];
}

export function validatePlanningItemField(key: PlanningItemFieldKey, value: unknown) {
  const rule = PLANNING_ITEM_FIELD_RULES[key];
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
  if (rule.kind === "string-array") {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? ""
      : "muss eine Liste aus Texten sein";
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

export type StrictPatchNormalization<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function optionalPatchText(value: unknown, maxLength: number): StrictPatchNormalization<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "muss Text oder null sein" };
  const text = cleanText(value, maxLength);
  return { ok: true, value: text || null };
}

export function normalizePatchText(value: unknown, maxLength: number, required = false): StrictPatchNormalization<string | null> {
  const normalized = optionalPatchText(value, maxLength);
  if (!normalized.ok) return normalized;
  if (required && !normalized.value) return { ok: false, error: "darf nicht leer sein" };
  return normalized;
}

export function normalizePatchAcceptanceCriteria(value: unknown): StrictPatchNormalization<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value === "string") return normalizePatchText(value, 6_000);
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return { ok: false, error: "muss Text, eine Textliste oder null sein" };
  }
  const text = value
    .map((item) => cleanText(item, 1_000))
    .filter(Boolean)
    .join("\n");
  return { ok: true, value: text || null };
}

export function normalizePatchDate(value: unknown): StrictPatchNormalization<string | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false, error: "muss ein Datum oder null sein" };
  const text = cleanText(value, 20);
  if (!text) return { ok: true, value: null };
  if (intakeDate(text) !== text) return { ok: false, error: "muss ein gültiges Datum im Format YYYY-MM-DD sein" };
  return { ok: true, value: text };
}

export function normalizePatchPriority(value: unknown): StrictPatchNormalization<string> {
  if (typeof value !== "string") return { ok: false, error: "muss eine Priorität sein" };
  const priority = cleanText(value, 10);
  if (!priorities.has(priority)) return { ok: false, error: "muss P0, P1, P2, P3 oder P4 sein" };
  return { ok: true, value: priority };
}

export function normalizePatchMilestoneStatus(value: unknown): StrictPatchNormalization<string> {
  if (typeof value !== "string") return { ok: false, error: "muss ein Meilenstein-Status sein" };
  const status = cleanText(value, 40);
  if (!milestoneStatuses.has(status)) return { ok: false, error: "muss planned, active oder done sein" };
  return { ok: true, value: status };
}

export function normalizePatchHours(value: unknown): StrictPatchNormalization<number | null> {
  if (value === null) return { ok: true, value: null };
  if (typeof value !== "number" || !Number.isFinite(value)) return { ok: false, error: "muss eine Zahl oder null sein" };
  if (value < 0 || value > 200) return { ok: false, error: "muss zwischen 0 und 200 liegen" };
  return { ok: true, value: Math.round(value) };
}

export function normalizePatchId(value: unknown, required = false): StrictPatchNormalization<string | null> {
  const normalized = normalizePatchText(value, 120, required);
  return normalized;
}

export function normalizePatchStringList(value: unknown, required = false): StrictPatchNormalization<string[]> {
  if (value === null) {
    return required
      ? { ok: false, error: "darf nicht leer sein" }
      : { ok: true, value: [] };
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { ok: false, error: "muss eine Textliste oder null sein" };
  }
  const entries = [...new Set(value.map((entry) => cleanText(entry, 120)).filter(Boolean))];
  if (required && !entries.length) return { ok: false, error: "darf nicht leer sein" };
  return { ok: true, value: entries };
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
