"use client";

import { createBrowserApiClient } from "@/lib/browser-api-client";

const apiClient = createBrowserApiClient();

type PlatformReleaseRequestOptions = Omit<RequestInit, "body">;

export function platformReleaseRequest<T>(path: string, init: PlatformReleaseRequestOptions = {}) {
  return apiClient.requestJson<T>(path, {
    ...init,
    cache: "no-store",
  });
}
