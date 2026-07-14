import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapMilestone } from "@/lib/planning-profile-mappers";
import type { DbMilestone } from "@/lib/planning-data-row-types";
import { slugify } from "@/lib/slug";
import {
  MILESTONE_NOT_EMPTY_CODE,
  MILESTONE_STATUSES,
  type MilestoneChildCounts,
  type MilestoneCreateRequest,
  type MilestoneDeleteRequest,
  type MilestoneDto,
  type MilestoneNotEmptyError,
  type MilestonePatchRequest,
  type MilestoneStatus,
} from "./milestone-contract";
import { milestoneNotEmptyMessage, normalizeMilestoneChildCounts } from "./milestone-policy";

export const MILESTONE_PROJECT_ID = "findmydoc-founder-execution";
export const MILESTONE_SELECT = "id,title,description,target_date,status,sort_order,updated_at";

const CREATE_FIELDS = new Set(["title", "description", "targetDate", "status"]);
const PATCH_FIELDS = new Set(["expectedUpdatedAt", "title", "description", "targetDate", "status"]);
const DELETE_FIELDS = new Set(["expectedUpdatedAt"]);
const STATUS_SET = new Set<string>(MILESTONE_STATUSES);

type ValidationSuccess<T> = { ok: true; value: T };
type ValidationFailure = { ok: false; error: string };
export type MilestoneValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export type NormalizedMilestoneCreate = {
  title: string;
  description: string;
  targetDate: string | null;
  status: MilestoneStatus;
};

export type NormalizedMilestonePatch = {
  expectedUpdatedAt: string;
  update: Partial<Pick<NormalizedMilestoneCreate, "title" | "description" | "targetDate" | "status">>;
};

export type NormalizedMilestoneDelete = {
  expectedUpdatedAt: string;
};

type DatabaseErrorLike = {
  code?: string | null;
  message?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function unknownFields(payload: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(payload).filter((field) => !allowed.has(field));
}

function validateKnownFields(payload: Record<string, unknown>, allowed: Set<string>): ValidationFailure | null {
  const unknown = unknownFields(payload, allowed);
  if (!unknown.length) return null;
  return { ok: false, error: `Unbekanntes Feld: ${unknown.join(", ")}.` };
}

function normalizeTitle(value: unknown): MilestoneValidationResult<string> {
  if (typeof value !== "string") return { ok: false, error: "Titel ist erforderlich." };
  const title = value.trim();
  if (title.length < 3) return { ok: false, error: "Titel muss mindestens 3 Zeichen enthalten." };
  if (title.length > 240) return { ok: false, error: "Titel darf maximal 240 Zeichen enthalten." };
  return { ok: true, value: title };
}

function normalizeDescription(value: unknown): MilestoneValidationResult<string> {
  if (value === undefined || value === null) return { ok: true, value: "" };
  if (typeof value !== "string") return { ok: false, error: "Beschreibung muss Text sein." };
  const description = value.trim();
  if (description.length > 4000) return { ok: false, error: "Beschreibung darf maximal 4.000 Zeichen enthalten." };
  return { ok: true, value: description };
}

export function isValidMilestoneDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeTargetDate(value: unknown): MilestoneValidationResult<string | null> {
  if (value === undefined || value === null || value === "") return { ok: true, value: null };
  if (!isValidMilestoneDate(value)) return { ok: false, error: "Zieldatum muss ein gültiges Datum im Format YYYY-MM-DD sein." };
  return { ok: true, value };
}

function normalizeStatus(value: unknown, fallback?: MilestoneStatus): MilestoneValidationResult<MilestoneStatus> {
  if (value === undefined && fallback) return { ok: true, value: fallback };
  if (typeof value !== "string" || !STATUS_SET.has(value)) {
    return { ok: false, error: "Ungültiger Meilenstein-Status." };
  }
  return { ok: true, value: value as MilestoneStatus };
}

export function isValidExpectedUpdatedAt(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/);
  if (!match || !isValidMilestoneDate(value.slice(0, 10))) return false;
  const [, hours, minutes, seconds, offsetHours = "00", offsetMinutes = "00"] = match;
  return Number(hours) <= 23
    && Number(minutes) <= 59
    && Number(seconds) <= 59
    && Number(offsetHours) <= 23
    && Number(offsetMinutes) <= 59
    && Number.isFinite(Date.parse(value));
}

function normalizeExpectedUpdatedAt(value: unknown): MilestoneValidationResult<string> {
  if (!isValidExpectedUpdatedAt(value)) {
    return { ok: false, error: "expectedUpdatedAt muss ein gültiger Zeitstempel sein." };
  }
  return { ok: true, value };
}

export function parseMilestoneCreateRequest(payload: unknown): MilestoneValidationResult<NormalizedMilestoneCreate> {
  if (!isRecord(payload)) return { ok: false, error: "Ungültiger JSON-Body." };
  const knownFields = validateKnownFields(payload, CREATE_FIELDS);
  if (knownFields) return knownFields;

  const title = normalizeTitle(payload.title);
  if (!title.ok) return title;
  const description = normalizeDescription(payload.description);
  if (!description.ok) return description;
  const targetDate = normalizeTargetDate(payload.targetDate);
  if (!targetDate.ok) return targetDate;
  const status = normalizeStatus(payload.status, "planned");
  if (!status.ok) return status;

  return {
    ok: true,
    value: {
      title: title.value,
      description: description.value,
      targetDate: targetDate.value,
      status: status.value,
    },
  };
}

export function parseMilestonePatchRequest(payload: unknown): MilestoneValidationResult<NormalizedMilestonePatch> {
  if (!isRecord(payload)) return { ok: false, error: "Ungültiger JSON-Body." };
  const knownFields = validateKnownFields(payload, PATCH_FIELDS);
  if (knownFields) return knownFields;

  const expectedUpdatedAt = normalizeExpectedUpdatedAt(payload.expectedUpdatedAt);
  if (!expectedUpdatedAt.ok) return expectedUpdatedAt;

  const update: NormalizedMilestonePatch["update"] = {};
  if (Object.hasOwn(payload, "title")) {
    const title = normalizeTitle(payload.title);
    if (!title.ok) return title;
    update.title = title.value;
  }
  if (Object.hasOwn(payload, "description")) {
    const description = normalizeDescription(payload.description);
    if (!description.ok) return description;
    update.description = description.value;
  }
  if (Object.hasOwn(payload, "targetDate")) {
    const targetDate = normalizeTargetDate(payload.targetDate);
    if (!targetDate.ok) return targetDate;
    update.targetDate = targetDate.value;
  }
  if (Object.hasOwn(payload, "status")) {
    const status = normalizeStatus(payload.status);
    if (!status.ok) return status;
    update.status = status.value;
  }
  if (!Object.keys(update).length) {
    return { ok: false, error: "Mindestens ein änderbares Meilenstein-Feld ist erforderlich." };
  }

  return { ok: true, value: { expectedUpdatedAt: expectedUpdatedAt.value, update } };
}

export function parseMilestoneDeleteRequest(payload: unknown): MilestoneValidationResult<NormalizedMilestoneDelete> {
  if (!isRecord(payload)) return { ok: false, error: "Ungültiger JSON-Body." };
  const knownFields = validateKnownFields(payload, DELETE_FIELDS);
  if (knownFields) return knownFields;
  const expectedUpdatedAt = normalizeExpectedUpdatedAt(payload.expectedUpdatedAt);
  if (!expectedUpdatedAt.ok) return expectedUpdatedAt;
  return { ok: true, value: { expectedUpdatedAt: expectedUpdatedAt.value } };
}

export function createMilestoneId(title: string) {
  const slug = slugify(title, { maxLength: 60 }) || "neu";
  return `milestone-${slug}-${randomUUID()}`;
}

export function buildMilestoneInsert(input: NormalizedMilestoneCreate, id = createMilestoneId(input.title)) {
  return {
    id,
    project_id: MILESTONE_PROJECT_ID,
    title: input.title,
    description: input.description || null,
    target_date: input.targetDate,
    status: input.status,
  };
}

export function buildMilestoneUpdate(input: NormalizedMilestonePatch["update"]) {
  const update: Record<string, string | null> = {};
  if (input.title !== undefined) update.title = input.title;
  if (input.description !== undefined) update.description = input.description || null;
  if (input.targetDate !== undefined) update.target_date = input.targetDate;
  if (input.status !== undefined) update.status = input.status;
  return update;
}

export function mapMilestoneRow(row: DbMilestone): MilestoneDto {
  return mapMilestone(row);
}

export async function listProjectMilestones(supabase: SupabaseClient) {
  return supabase
    .from("milestones")
    .select(MILESTONE_SELECT)
    .eq("project_id", MILESTONE_PROJECT_ID)
    .order("sort_order")
    .order("id")
    .returns<DbMilestone[]>();
}

export async function loadProjectMilestone(supabase: SupabaseClient, id: string) {
  return supabase
    .from("milestones")
    .select(MILESTONE_SELECT)
    .eq("project_id", MILESTONE_PROJECT_ID)
    .eq("id", id)
    .maybeSingle<DbMilestone>();
}

export async function insertProjectMilestone(supabase: SupabaseClient, input: NormalizedMilestoneCreate) {
  const insert = buildMilestoneInsert(input);
  const result = await supabase
    .from("milestones")
    .insert(insert)
    .select(MILESTONE_SELECT)
    .single<DbMilestone>();
  return { ...result, insert };
}

export async function updateProjectMilestone(
  supabase: SupabaseClient,
  id: string,
  expectedUpdatedAt: string,
  input: NormalizedMilestonePatch["update"],
) {
  const update = buildMilestoneUpdate(input);
  const result = await supabase
    .from("milestones")
    .update(update)
    .eq("project_id", MILESTONE_PROJECT_ID)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select(MILESTONE_SELECT)
    .maybeSingle<DbMilestone>();
  return { ...result, update };
}

export async function deleteProjectMilestone(supabase: SupabaseClient, id: string, expectedUpdatedAt: string) {
  return supabase
    .from("milestones")
    .delete()
    .eq("project_id", MILESTONE_PROJECT_ID)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select(MILESTONE_SELECT)
    .maybeSingle<DbMilestone>();
}

export async function loadMilestoneChildCounts(
  supabase: SupabaseClient,
  milestoneId: string,
): Promise<
  | { ok: true; counts: MilestoneChildCounts }
  | { ok: false; error: DatabaseErrorLike }
> {
  const [initiativeResult, taskResult] = await Promise.all([
    supabase.from("packages").select("id", { count: "exact", head: true }).eq("milestone_id", milestoneId),
    supabase.from("tasks").select("id", { count: "exact", head: true }).eq("milestone_id", milestoneId),
  ]);
  const error = initiativeResult.error || taskResult.error;
  if (error) return { ok: false, error };
  return {
    ok: true,
    counts: normalizeMilestoneChildCounts({
      initiatives: initiativeResult.count || 0,
      tasks: taskResult.count || 0,
    }),
  };
}

export function milestoneDatabaseErrorCode(error: unknown) {
  if (!isRecord(error) || typeof error.code !== "string") return "";
  return error.code;
}

export function isMilestoneNotEmptyDatabaseError(error: unknown) {
  const code = milestoneDatabaseErrorCode(error);
  return code === "23503" || code === "P0008";
}

export function milestoneNotEmptyError(counts: MilestoneChildCounts): MilestoneNotEmptyError {
  const children = normalizeMilestoneChildCounts(counts);
  return {
    code: MILESTONE_NOT_EMPTY_CODE,
    error: milestoneNotEmptyMessage(children),
    children,
  };
}

export type {
  MilestoneCreateRequest,
  MilestoneDeleteRequest,
  MilestonePatchRequest,
};
