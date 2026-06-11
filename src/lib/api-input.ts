import type { NextRequest } from "next/server";

export function cleanText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function cleanOptionalText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : "";
}

export function isIsoDate(value: unknown) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function cleanDate(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  return isIsoDate(value) ? value : "";
}

export function cleanOptionalDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  return isIsoDate(value) ? value : undefined;
}

export function cleanTime(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  return /^\d{2}:\d{2}$/.test(value) ? value : "";
}

export function auditRequestMetadata(request: Pick<NextRequest, "headers">) {
  return {
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  };
}
