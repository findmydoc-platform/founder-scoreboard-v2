import { NextResponse } from "next/server";
import type { AuthzResult } from "./authz";

type FailedAuthzResult = Extract<AuthzResult, { ok: false }>;

export function apiError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export function authzError(permission: FailedAuthzResult) {
  return apiError(permission.error, permission.status);
}

export function supabaseUnavailable(message = "Supabase env is not configured.") {
  return apiError(message, 501);
}
