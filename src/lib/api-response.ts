import { NextResponse, type NextRequest } from "next/server";
import type { AuthzResult } from "./credentials/auth-types";

type FailedAuthzResult = Extract<AuthzResult, { ok: false }>;
type AuthzErrorFields = Record<string, unknown> & { code?: never; error?: never };

export function apiError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export function authzError(permission: FailedAuthzResult, fields: AuthzErrorFields = {}) {
  const safeFields = { ...fields } as Record<string, unknown>;
  delete safeFields.code;
  delete safeFields.error;
  return NextResponse.json({
    ...safeFields,
    ...(permission.code ? { code: permission.code } : {}),
    error: permission.error,
  }, { status: permission.status });
}

export function supabaseUnavailable(message = "Supabase env is not configured.") {
  return apiError(message, 501);
}

export async function readJsonPayload<T>(request: NextRequest, fallback: T): Promise<T> {
  return (await request.json().catch(() => fallback)) as T;
}
