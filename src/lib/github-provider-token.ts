"use client";

let rememberedGitHubProviderToken = "";

export function rememberGitHubProviderToken(token?: string | null) {
  if (token) rememberedGitHubProviderToken = token;
}

export function getRememberedGitHubProviderToken() {
  return rememberedGitHubProviderToken;
}

export function hasRememberedGitHubProviderToken() {
  return Boolean(rememberedGitHubProviderToken);
}

export function clearRememberedGitHubProviderToken() {
  rememberedGitHubProviderToken = "";
}
