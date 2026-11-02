export function mockAccountLifecycle(mode: string, account?: { linked: boolean; workspaceEmail?: string; workspaceAvatarUrl?: string }) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input).includes("/api/auth/login-mode")
    ? Response.json({ mode }) : String(input).includes("/api/auth/account-state")
      ? Response.json(account || { linked: false }) : previous(input, init);
  return () => { globalThis.fetch = previous; };
}
