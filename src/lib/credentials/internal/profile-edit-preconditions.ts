import type { AccountSettingsExpected } from "../account-types";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const scalar = (value: unknown) => value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

function sameFields(expected: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.keys(expected).length === Object.keys(patch).length && Object.keys(patch).every(key => has(expected, key));
}

export function settingsPreconditions(value: unknown, profile: Record<string, unknown>, ui: Record<string, unknown> | null, events: Record<string, boolean>): { ok: false } | { ok: true; value?: AccountSettingsExpected } {
  if (value === undefined) return { ok: true };
  if (!object(value) || Object.keys(value).some(key => !["profile", "ui", "events"].includes(key)) || !object(value.profile)) return { ok: false };
  const comparedProfile = Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "profile_color_duplicate_mode"));
  if (!sameFields(value.profile, comparedProfile) || Object.values(value.profile).some(item => !scalar(item))) return { ok: false };
  if (ui) {
    if (!has(value, "ui") || (value.ui !== null && (!object(value.ui) || !sameFields(value.ui, ui)))) return { ok: false };
  } else if (has(value, "ui")) return { ok: false };
  const comparedEvents = value.events === undefined ? {} : value.events;
  if (!object(comparedEvents) || !sameFields(comparedEvents, events) || Object.values(comparedEvents).some(item => item !== null && typeof item !== "boolean")) return { ok: false };
  return { ok: true, value: value as AccountSettingsExpected };
}

export function governancePreconditions(value: unknown, patch: Record<string, unknown>): { ok: false } | { ok: true; value?: Record<string, unknown> } {
  if (value === undefined) return { ok: true };
  if (!object(value) || !sameFields(value, patch) || Object.values(value).some(item => !scalar(item))) return { ok: false };
  return { ok: true, value };
}
