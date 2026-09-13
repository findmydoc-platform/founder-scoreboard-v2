"use client";

import { isInvalidSessionBeforeEffectBody } from "@/lib/auth-error-contract";
import {
  createSupabaseBrowserSessionAdapter,
  type BrowserSessionPort,
  type BrowserSessionSnapshot,
} from "@/lib/browser-session-adapter";

type BrowserApiClientOptions = {
  devProfileId?: string;
  devProfileOverrideEnabled?: boolean;
  sessionPort?: BrowserSessionPort;
};

type BrowserApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  headers?: HeadersInit;
  json?: unknown;
  jsonContentType?: boolean;
  useDevProfileOverride?: boolean;
};

type BrowserApiFormOptions = Omit<BrowserApiRequestOptions, "json" | "jsonContentType">;
type BrowserApiInput = string | URL;

export type BrowserApiJsonResult<T> = {
  response: Response;
  body: T | null;
};

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isMutationMethod(method: string) {
  return mutationMethods.has(method);
}

export function createBrowserApiClient({
  devProfileId = "",
  devProfileOverrideEnabled = false,
  sessionPort = createSupabaseBrowserSessionAdapter(),
}: BrowserApiClientOptions = {}) {
  function prepareRequest(options: BrowserApiRequestOptions = {}) {
    const {
      headers: requestHeaders,
      json,
      jsonContentType = true,
      useDevProfileOverride = true,
      ...requestInit
    } = options;
    const headers = new Headers(requestHeaders);
    const method = (requestInit.method || "GET").toUpperCase();
    const hasJsonPayload = Object.prototype.hasOwnProperty.call(options, "json");
    const body = hasJsonPayload ? JSON.stringify(json) : undefined;

    if (jsonContentType && !headers.has("content-type") && (hasJsonPayload || isMutationMethod(method))) {
      headers.set("content-type", "application/json");
    }

    if (useDevProfileOverride && devProfileOverrideEnabled && devProfileId && !headers.has("x-fmd-dev-profile-id")) {
      headers.set("x-fmd-dev-profile-id", devProfileId);
    }

    return {
      callerAuthorization: headers.has("authorization"),
      replayAllowed: method === "GET" || method === "HEAD" || typeof body === "string",
      requestInit: { ...requestInit, body, headers, method },
    };
  }

  async function send(
    input: BrowserApiInput,
    requestInit: RequestInit,
    session: BrowserSessionSnapshot | null,
  ) {
    const headers = new Headers(requestInit.headers);
    if (session?.accessToken && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${session.accessToken}`);
    }
    const response = await fetch(input, { ...requestInit, headers });
    return {
      attachedSession: session,
      response,
    };
  }

  async function recoverAndReplay(
    input: BrowserApiInput,
    requestInit: RequestInit,
    firstResponse: Response,
    firstBody: unknown,
    rejectedSession: BrowserSessionSnapshot | null,
    replayAllowed = true,
  ) {
    if (
      !replayAllowed
      || firstResponse.status !== 401
      || !rejectedSession
      || !isInvalidSessionBeforeEffectBody(firstBody)
    ) {
      return null;
    }

    const recovery = await sessionPort.recover(rejectedSession);
    if (recovery.kind !== "refreshed") return null;
    return send(input, requestInit, recovery.session);
  }

  async function requestJson<T>(
    input: BrowserApiInput,
    options: BrowserApiRequestOptions = {},
  ): Promise<BrowserApiJsonResult<T>> {
    const prepared = prepareRequest(options);
    const session = prepared.callerAuthorization ? null : await sessionPort.current();
    const first = await send(input, prepared.requestInit, session);
    const firstBody = await first.response.clone().json().catch(() => null) as T | null;
    const replay = await recoverAndReplay(
      input,
      prepared.requestInit,
      first.response,
      firstBody,
      first.attachedSession,
      prepared.replayAllowed,
    );
    if (!replay) return { response: first.response, body: firstBody };

    const replayBody = await replay.response.clone().json().catch(() => null) as T | null;
    if (replay.response.status === 401 && isInvalidSessionBeforeEffectBody(replayBody)) {
      if (replay.attachedSession) await sessionPort.clearIfCurrent(replay.attachedSession);
    }
    return { response: replay.response, body: replayBody };
  }

  async function requestForm<T>(
    input: BrowserApiInput,
    formData: FormData,
    options: BrowserApiFormOptions = {},
  ): Promise<BrowserApiJsonResult<T>> {
    const { headers: requestHeaders, useDevProfileOverride = true, ...requestInit } = options;
    const headers = new Headers(requestHeaders);
    if (useDevProfileOverride && devProfileOverrideEnabled && devProfileId && !headers.has("x-fmd-dev-profile-id")) {
      headers.set("x-fmd-dev-profile-id", devProfileId);
    }
    const callerAuthorization = headers.has("authorization");
    const session = callerAuthorization ? null : await sessionPort.current();
    const result = await send(input, {
      ...requestInit,
      body: formData,
      headers,
      method: (requestInit.method || "POST").toUpperCase(),
    }, session);
    const body = await result.response.clone().json().catch(() => null) as T | null;
    return { response: result.response, body };
  }

  async function requestBlob(input: BrowserApiInput, options: BrowserApiFormOptions = {}) {
    const prepared = prepareRequest(options);
    const session = prepared.callerAuthorization ? null : await sessionPort.current();
    const first = await send(input, prepared.requestInit, session);
    const firstErrorBody = first.response.ok ? null : await first.response.clone().json().catch(() => null);
    const replay = await recoverAndReplay(
      input,
      prepared.requestInit,
      first.response,
      firstErrorBody,
      first.attachedSession,
      prepared.requestInit.method === "GET" || prepared.requestInit.method === "HEAD",
    );
    const result = replay || first;
    const replayErrorBody = replay && !replay.response.ok
      ? await replay.response.clone().json().catch(() => null)
      : null;
    if (replay?.response.status === 401 && isInvalidSessionBeforeEffectBody(replayErrorBody)) {
      if (replay.attachedSession) await sessionPort.clearIfCurrent(replay.attachedSession);
    }
    const blob = result.response.ok ? await result.response.blob() : null;
    return { response: result.response, blob };
  }

  return {
    requestBlob,
    requestForm,
    requestJson,
  };
}

export type BrowserApiClient = ReturnType<typeof createBrowserApiClient>;
