import { timingSafeEqual } from "node:crypto";

export const FOUNDEROPS_MAINTENANCE_SECRET_HEADER = "x-founderops-maintenance-secret";

function secretValuesMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length
    && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function validateMaintenanceSecret(provided: string | null | undefined) {
  const candidate = provided?.trim() || "";
  const expected = process.env.FOUNDEROPS_MAINTENANCE_SECRET?.trim() || "";
  return Boolean(candidate && expected && secretValuesMatch(candidate, expected));
}

function bearerCredential(value: string | null | undefined) {
  const match = /^\s*Bearer\s+(.+?)\s*$/i.exec(value || "");
  return match?.[1] || "";
}

export function hasCronSecret() {
  return Boolean(process.env.CRON_SECRET?.trim());
}

export function validateCronSecret(provided: string | null | undefined) {
  const candidate = bearerCredential(provided);
  const expected = process.env.CRON_SECRET?.trim() || "";
  return Boolean(candidate && expected && secretValuesMatch(candidate, expected));
}
