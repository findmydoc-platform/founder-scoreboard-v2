"use client";

import { getBrowserSupabase } from "@/lib/supabase";

type BrowserApiClientOptions = {
  devProfileId?: string;
  devProfileOverrideEnabled?: boolean;
};

type BrowserApiRequestOptions = Omit<RequestInit, "body" | "headers"> & {
  body?: BodyInit | null;
  headers?: HeadersInit;
  json?: unknown;
  jsonContentType?: boolean;
};

export type BrowserApiJsonResult<T> = {
  response: Response;
  body: T | null;
};

export type BrowserAuthSnapshot = {
  githubLogin: string;
  githubAppConnected: boolean;
};

function currentRelativeUrl() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
}

function authLoginFromSession(session: Awaited<ReturnType<NonNullable<ReturnType<typeof getBrowserSupabase>>["auth"]["getSession"]>>["data"]["session"]) {
  return String(session?.user.user_metadata?.user_name || session?.user.user_metadata?.preferred_username || "");
}

export function createBrowserApiClient({
  devProfileId = "",
  devProfileOverrideEnabled = false,
}: BrowserApiClientOptions = {}) {
  async function readSession() {
    const session = await getBrowserSupabase()?.auth.getSession();
    const currentSession = session?.data.session || null;
    return currentSession;
  }

  async function buildRequest(input: RequestInfo | URL, options: BrowserApiRequestOptions = {}) {
    const { body: requestBody, headers: requestHeaders, json, jsonContentType, ...requestInit } = options;
    const session = await readSession();
    const headers = new Headers(requestHeaders);
    const method = (requestInit.method || "GET").toUpperCase();
    const hasJsonPayload = Object.prototype.hasOwnProperty.call(options, "json");
    const body = hasJsonPayload ? JSON.stringify(json) : requestBody;

    if (
      jsonContentType !== false
      && !headers.has("content-type")
      && (hasJsonPayload || ["POST", "PUT", "PATCH", "DELETE"].includes(method))
      && !(body instanceof FormData)
    ) {
      headers.set("content-type", "application/json");
    }

    if (session?.access_token && !headers.has("authorization")) {
      headers.set("authorization", `Bearer ${session.access_token}`);
    }

    if (devProfileOverrideEnabled && devProfileId && !headers.has("x-fmd-dev-profile-id")) {
      headers.set("x-fmd-dev-profile-id", devProfileId);
    }

    return fetch(input, {
      ...requestInit,
      method,
      headers,
      body,
    });
  }

  async function requestJson<T>(input: RequestInfo | URL, options: BrowserApiRequestOptions = {}): Promise<BrowserApiJsonResult<T>> {
    const response = await buildRequest(input, options);
    const body = await response.json().catch(() => null) as T | null;
    return { response, body };
  }

  async function requestForm<T>(input: RequestInfo | URL, formData: FormData, options: BrowserApiRequestOptions = {}): Promise<BrowserApiJsonResult<T>> {
    return requestJson<T>(input, {
      ...options,
      method: options.method || "POST",
      body: formData,
      jsonContentType: false,
    });
  }

  async function requestBlob(input: RequestInfo | URL, options: BrowserApiRequestOptions = {}) {
    const response = await buildRequest(input, options);
    const blob = response.ok ? await response.blob() : null;
    return { response, blob };
  }

  async function getAuthSnapshot(): Promise<BrowserAuthSnapshot> {
    const session = await readSession();
    let githubAppConnected = false;
    if (session?.access_token) {
      const status = await fetch("/api/github-app/status", {
        headers: { authorization: `Bearer ${session.access_token}` },
      }).then((response) => response.ok ? response.json() : null).catch(() => null) as { connected?: boolean } | null;
      githubAppConnected = Boolean(status?.connected);
    }
    return {
      githubLogin: authLoginFromSession(session),
      githubAppConnected,
    };
  }

  async function startGitHubAppConnect() {
    window.location.assign(`/api/github-app/connect?next=${encodeURIComponent(currentRelativeUrl())}`);
    return { error: null };
  }

  return {
    getAuthSnapshot,
    requestBlob,
    requestForm,
    requestJson,
    startGitHubAppConnect,
  };
}

export type BrowserApiClient = ReturnType<typeof createBrowserApiClient>;
