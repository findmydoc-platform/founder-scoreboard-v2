import { NextResponse, type NextRequest } from "next/server";
import type { AuthzResult } from "./authz";
import { getServerSupabase } from "./supabase";

type FailedAuthzResult = Extract<AuthzResult, { ok: false }>;
type SuccessfulAuthzResult = Extract<AuthzResult, { ok: true }>;
type ServerSupabase = NonNullable<ReturnType<typeof getServerSupabase>>;
type ApiAuthorization = (request: NextRequest) => AuthzResult | Promise<AuthzResult>;

type ApiContextResult =
  | { ok: true; supabase: ServerSupabase; permission: SuccessfulAuthzResult }
  | { ok: false; response: NextResponse };

type ApiJsonContextResult<T> =
  | { ok: true; supabase: ServerSupabase; permission: SuccessfulAuthzResult; payload: T }
  | { ok: false; response: NextResponse };

type ApiContextOptions = {
  supabaseUnavailableMessage?: string;
};

export function apiError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

export function authzError(permission: FailedAuthzResult) {
  return apiError(permission.error, permission.status);
}

export function supabaseUnavailable(message = "Supabase env is not configured.") {
  return apiError(message, 501);
}

export async function requireApiContext(
  request: NextRequest,
  authorize: ApiAuthorization,
  options: ApiContextOptions = {},
): Promise<ApiContextResult> {
  const supabase = getServerSupabase();
  if (!supabase) return { ok: false, response: supabaseUnavailable(options.supabaseUnavailableMessage) };

  const permission = await authorize(request);
  if (!permission.ok) return { ok: false, response: authzError(permission) };

  return { ok: true, supabase, permission };
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
