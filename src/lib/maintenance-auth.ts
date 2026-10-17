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
