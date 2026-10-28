"use client";

import { isInvalidSessionBeforeEffectBody, workspaceTransitionTarget } from "@/lib/auth-error-contract";
import {
  createBrowserSessionAdapter,
  type BrowserSessionPort,
  type BrowserSessionSnapshot,
} from "@/lib/credentials/browser";

type BrowserApiClientOptions = {
  devProfileId?: string;
  devProfileOverrideEnabled?: boolean;
  sessionPort?: BrowserSessionPort;
  onWorkspaceTransition?: (target: string) => void;
};

type BrowserApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  headers?: HeadersInit;
  json?: unknown;
  jsonContentType?: boolean;
  useDevProfileOverride?: boolean;
  expectedSession?: Pick<BrowserSessionSnapshot, "userId" | "revision"> & { isCurrent?: () => boolean };
};

type BrowserApiBlobOptions = Omit<BrowserApiRequestOptions, "json" | "jsonContentType">;
type BrowserApiFormOptions = BrowserApiBlobOptions & { expectedSession?: Pick<BrowserSessionSnapshot, "userId" | "revision"> & { isCurrent?: () => boolean } };
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
  sessionPort = createBrowserSessionAdapter(),
  onWorkspaceTransition = target => window.location.replace(target),
}: BrowserApiClientOptions = {}) {
  let transitioning = false;

  function transitionIfRequired(response: Response, body: unknown, session: BrowserSessionSnapshot | null) {
    if (!session || response.status !== 403 || transitioning) return;
    const target = workspaceTransitionTarget(body);
    if (!target) return;
    transitioning = true;
    // A full navigation removes protected in-memory state while retaining the GitHub session needed to link.
    onWorkspaceTransition(target);
  }

  function prepareRequest(options: BrowserApiRequestOptions = {}) {
    const {
      headers: requestHeaders,
      json,
      jsonContentType = true,
      useDevProfileOverride = true,
      expectedSession,
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
      expectedSession,
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
    const received = await fetch(input, { credentials: "same-origin", ...requestInit, headers });
    const response = session && sessionPort.isCurrent && !sessionPort.isCurrent(session)
      ? Response.json({ error: "Die Sitzung wurde ersetzt.", code: "session_superseded" }, { status: 409 }) : received;
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
    expectedSession?: Pick<BrowserSessionSnapshot, "userId" | "revision"> & { isCurrent?: () => boolean },
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
    if (expectedSession && (expectedSession.isCurrent?.() === false || recovery.session.userId !== expectedSession.userId || recovery.session.expiresAt * 1000 <= Date.now() || sessionPort.isCurrent && !sessionPort.isCurrent(recovery.session))) {
      return { attachedSession: null, response: Response.json({ error: "Die Sitzung wurde ersetzt.", code: "session_superseded" }, { status: 409 }) };
    }
    return send(input, requestInit, recovery.session);
  }

  async function requestJson<T>(
    input: BrowserApiInput,
    options: BrowserApiRequestOptions = {},
  ): Promise<BrowserApiJsonResult<T>> {
    const prepared = prepareRequest(options);
    const session = prepared.callerAuthorization ? null : await sessionPort.current();
    if (prepared.expectedSession && (prepared.expectedSession.isCurrent?.() === false || !prepared.expectedSession.userId || !prepared.expectedSession.revision || !session || session.expiresAt * 1000 <= Date.now() || session.userId !== prepared.expectedSession.userId || session.revision !== prepared.expectedSession.revision || sessionPort.isCurrent && !sessionPort.isCurrent(session))) {
      const body = { error: "Die Sitzung wurde ersetzt.", code: "session_superseded" };
      return { response: Response.json(body, { status: 409 }), body: body as T };
    }
    const first = await send(input, prepared.requestInit, session);
    const firstBody = await first.response.clone().json().catch(() => null) as T | null;
    transitionIfRequired(first.response, firstBody, first.attachedSession);
    const replay = await recoverAndReplay(
      input,
      prepared.requestInit,
      first.response,
      firstBody,
      first.attachedSession,
      prepared.replayAllowed,
      prepared.expectedSession,
    );
    if (!replay) return { response: first.response, body: firstBody };

    const replayBody = await replay.response.clone().json().catch(() => null) as T | null;
    transitionIfRequired(replay.response, replayBody, replay.attachedSession);
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
    const { headers: requestHeaders, useDevProfileOverride = true, expectedSession, ...requestInit } = options;
    const headers = new Headers(requestHeaders);
    if (useDevProfileOverride && devProfileOverrideEnabled && devProfileId && !headers.has("x-fmd-dev-profile-id")) {
      headers.set("x-fmd-dev-profile-id", devProfileId);
    }
    const callerAuthorization = headers.has("authorization");
    const session = callerAuthorization ? null : await sessionPort.current();
    if (expectedSession && (expectedSession.isCurrent?.() === false || !session || session.expiresAt * 1000 <= Date.now() || session.userId !== expectedSession.userId || session.revision !== expectedSession.revision || sessionPort.isCurrent && !sessionPort.isCurrent(session))) {
      const body = { error: "Die Sitzung wurde ersetzt.", code: "session_superseded" };
      return { response: Response.json(body, { status: 409 }), body: body as T };
    }
    const result = await send(input, {
      ...requestInit,
      body: formData,
      headers,
      method: (requestInit.method || "POST").toUpperCase(),
    }, session);
    const body = await result.response.clone().json().catch(() => null) as T | null;
    transitionIfRequired(result.response, body, result.attachedSession);
    return { response: result.response, body };
  }

  async function requestBlob(input: BrowserApiInput, options: BrowserApiBlobOptions = {}) {
    const prepared = prepareRequest(options);
    const session = prepared.callerAuthorization ? null : await sessionPort.current();
    if (prepared.expectedSession && (prepared.expectedSession.isCurrent?.() === false || !session || session.expiresAt * 1000 <= Date.now() || session.userId !== prepared.expectedSession.userId || session.revision !== prepared.expectedSession.revision || sessionPort.isCurrent && !sessionPort.isCurrent(session))) {
      return { response: Response.json({ error: "Die Sitzung wurde ersetzt.", code: "session_superseded" }, { status: 409 }), blob: null };
    }
    const first = await send(input, prepared.requestInit, session);
    const firstErrorBody = first.response.ok ? null : await first.response.clone().json().catch(() => null);
    transitionIfRequired(first.response, firstErrorBody, first.attachedSession);
    const replay = await recoverAndReplay(
      input,
      prepared.requestInit,
      first.response,
      firstErrorBody,
      first.attachedSession,
      prepared.requestInit.method === "GET" || prepared.requestInit.method === "HEAD",
      prepared.expectedSession,
    );
    const result = replay || first;
    const replayErrorBody = replay && !replay.response.ok
      ? await replay.response.clone().json().catch(() => null)
      : null;
    if (replay) transitionIfRequired(replay.response, replayErrorBody, replay.attachedSession);
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
