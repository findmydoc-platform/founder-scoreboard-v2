import { NextResponse, type NextRequest } from "next/server";
import type { AuthErrorCode } from "./auth-error-contract";
import type { AuthzResult } from "./authz";
import { getServerSupabase } from "./supabase";

type FailedAuthzResult = Extract<AuthzResult, { ok: false }>;
type SuccessfulAuthzResult = Extract<AuthzResult, { ok: true }>;
type ServerSupabase = NonNullable<ReturnType<typeof getServerSupabase>>;
type ApiAuthorization<T extends AuthzResult = AuthzResult> = (request: NextRequest) => T | Promise<T>;

type ApiContextResult<T extends AuthzResult = AuthzResult> =
  | { ok: true; supabase: ServerSupabase; permission: Extract<T, { ok: true }> }
  | { ok: false; response: NextResponse; status: number; error: string; code?: AuthErrorCode };

type ApiJsonContextResult<T> =
  | { ok: true; supabase: ServerSupabase; permission: SuccessfulAuthzResult; payload: T }
  | { ok: false; response: NextResponse; status: number; error: string; code?: AuthErrorCode };

type ApiContextOptions = {
  supabaseUnavailableMessage?: string;
};
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

export async function requireApiContext<T extends AuthzResult>(
  request: NextRequest,
  authorize: ApiAuthorization<T>,
  options: ApiContextOptions = {},
): Promise<ApiContextResult<T>> {
  const supabase = getServerSupabase();
  if (!supabase) {
    const error = options.supabaseUnavailableMessage || "Supabase env is not configured.";
    return { ok: false, response: supabaseUnavailable(error), status: 501, error };
  }

  const permission = await authorize(request);
  if (!permission.ok) {
    return {
      ok: false,
      response: authzError(permission),
      status: permission.status,
      error: permission.error,
      code: permission.code,
    };
  }

  return { ok: true, supabase, permission: permission as Extract<T, { ok: true }> };
}

export async function readJsonPayload<T>(request: NextRequest, fallback: T): Promise<T> {
  return (await request.json().catch(() => fallback)) as T;
}

export async function requireJsonApiContext<T>(
  request: NextRequest,
  authorize: ApiAuthorization,
  fallback: T,
  options: ApiContextOptions = {},
): Promise<ApiJsonContextResult<T>> {
  const context = await requireApiContext(request, authorize, options);
  if (!context.ok) return context;

  const payload = await readJsonPayload<T>(request, fallback);
  return { ...context, payload };
}
