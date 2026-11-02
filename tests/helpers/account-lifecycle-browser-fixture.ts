export function mockAccountLifecycle(mode: string, account?: { linked: boolean; workspaceEmail?: string; workspaceAvatarUrl?: string }, respond?: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response> | undefined) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input).includes("/api/auth/login-mode")
    ? Response.json({ mode }) : String(input).includes("/api/auth/account-state")
      ? Response.json(account || { linked: false }) : respond?.(input, init) ?? previous(input, init);
  return () => { globalThis.fetch = previous; };
}
