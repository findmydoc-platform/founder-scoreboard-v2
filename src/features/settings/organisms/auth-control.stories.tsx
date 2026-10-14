import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AuthControl } from "./auth-control";
import type { User } from "@supabase/supabase-js";

const sampleWorkspaceAvatar = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='%23dbeafe'/%3E%3Ccircle cx='48' cy='36' r='18' fill='%233b82f6'/%3E%3Cpath d='M13 96c2-23 15-35 35-35s33 12 35 35' fill='%231d4ed8'/%3E%3C/svg%3E";

function loginMode(mode: string, account?: { linked: boolean; workspaceEmail?: string; workspaceAvatarUrl?: string }) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input).includes("/api/auth/login-mode")
    ? Response.json({ mode }) : String(input).includes("/api/auth/account-state")
      ? Response.json(account || { linked: false }) : previous(input, init);
  return () => { globalThis.fetch = previous; };
}
const meta = {
  title: "Settings/Authentication",
  component: AuthControl,
  args: { user: null, busy: false, variant: "gate", onSignIn: fn(), onSignOut: fn() },
  decorators: [(Story) => <div className="mx-auto w-full max-w-sm p-4"><Story /></div>],
  beforeEach: () => loginMode("google"),
} satisfies Meta<typeof AuthControl>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Google: Story = {
  play: async ({ canvasElement, args }) => {
    const button = await within(canvasElement).findByRole("button", { name: "Mit Google anmelden" });
    await expect(button).toBeEnabled();
    await userEvent.click(button);
    await expect(args.onSignIn).toHaveBeenCalled();
  },
};
export const Legacy: Story = {
  beforeEach: () => loginMode("legacy"),
  play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByRole("button", { name: "Mit GitHub anmelden" })).toBeEnabled(); },
};
export const Unavailable: Story = {
  beforeEach: () => loginMode("unavailable"),
  play: async ({ canvasElement }) => { await expect(await within(canvasElement).findByRole("button", { name: "Anmeldung nicht verfügbar" })).toBeDisabled(); },
};

export const Linking: Story = {
  beforeEach: () => loginMode("linking"),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("button", { name: "Mit Google anmelden" })).toBeEnabled();
    await expect(within(canvasElement).getByRole("link", { name: "Bestehendes Konto mit Google verknüpfen" })).toHaveAttribute("href", "/auth/link-google");
  },
};

export const LinkedAccount: Story = {
  args: {
    user: { id: "existing-user", aud: "authenticated", created_at: "2026-09-28T00:00:00Z", app_metadata: {}, email: "old@example.com", user_metadata: { full_name: "Founder", user_name: "old-github-handle" } } satisfies User,
    variant: "header",
  },
  beforeEach: () => loginMode("linking", { linked: true, workspaceEmail: "founder@findmydoc.eu", workspaceAvatarUrl: sampleWorkspaceAvatar }),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("img", { name: "Google-Profilbild" })).toHaveAttribute("src", sampleWorkspaceAvatar);
    await userEvent.click(await within(canvasElement).findByRole("button", { name: "Account-Menü öffnen" }));
    const menu = within(canvasElement).getByRole("dialog", { name: "Account und Testprofil" });
    await expect(within(menu).getByRole("img", { name: "Google-Profilbild" })).toBeVisible();
    await expect(await within(menu).findByText("founder@findmydoc.eu")).toBeVisible();
    await expect(within(menu).getByText("Google verbunden")).toBeVisible();
    await expect(within(menu).queryByText("old@example.com")).not.toBeInTheDocument();
    await expect(within(menu).queryByRole("link", { name: "Google-Konto verknüpfen" })).not.toBeInTheDocument();
  },
};

export const LinkedAccountGate: Story = {
  args: { ...LinkedAccount.args, variant: "gate" },
  beforeEach: LinkedAccount.beforeEach,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole("img", { name: "Google-Profilbild" })).toHaveAttribute("src", sampleWorkspaceAvatar);
    await expect(within(canvasElement).getByText("founder@findmydoc.eu")).toBeVisible();
  },
};

export const LinkedAccountWithoutAvatar: Story = {
  args: LinkedAccount.args,
  beforeEach: () => loginMode("linking", { linked: true, workspaceEmail: "founder@findmydoc.eu" }),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("F")).toBeVisible();
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(within(canvasElement).queryByRole("img", { name: "Google-Profilbild" })).not.toBeInTheDocument();
  },
};

export const LinkedAccountWithUnavailableAvatar: Story = {
  args: LinkedAccount.args,
  beforeEach: () => loginMode("linking", { linked: true, workspaceEmail: "founder@findmydoc.eu", workspaceAvatarUrl: "/missing-workspace-avatar.png" }),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText("F")).toBeVisible();
    await expect(within(canvasElement).queryByRole("img", { name: "Google-Profilbild" })).not.toBeInTheDocument();
  },
};
