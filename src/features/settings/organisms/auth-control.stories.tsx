import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { AuthControl } from "./auth-control";

function loginMode(mode: string) {
  const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => String(input).includes("/api/auth/login-mode")
    ? Response.json({ mode }) : previous(input, init);
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
