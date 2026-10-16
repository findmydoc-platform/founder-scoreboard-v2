import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { GoogleWorkspaceConnectionCard } from "./google-workspace-connection-card";
import type { BrowserApiClient } from "@/lib/browser-api-client";

const preview = fn();
const apiClient = { requestJson: async (input: string) => {
  if (input.endsWith("/disconnect")) {
    preview();
    return new Promise(() => {});
  }
  return { response: new Response(null, { status: 200 }), body: { connection: {
    state: "connected", calendarLabel: "team@example.test", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null,
  } } };
} } as unknown as BrowserApiClient;
const meta = {
  component: GoogleWorkspaceConnectionCard,
  title: "Team Workweek/Molecules/GoogleWorkspaceConnectionCard",
  args: { apiClient, compact: true, profile: { id: "owner", name: "Owner", platformRole: "founder", orgRole: "Founder", githubLogin: "owner", weeklyCapacity: 40, color: "#2563eb" } },
} satisfies Meta<typeof GoogleWorkspaceConnectionCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LoadsDisconnectPreviewOnlyWhenRequested: Story = {
  beforeEach: () => { preview.mockClear(); },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Verbunden");
    await expect(preview).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Verbindung trennen" }));
    await expect(preview).toHaveBeenCalledTimes(1);
    const dialog = within(canvas.getByRole("alertdialog"));
    await expect(dialog.getByRole("status")).toHaveTextContent("Trennungsvorschau wird geladen");
    await expect(dialog.getByRole("button", { name: "Verbindung trennen" })).toBeDisabled();
    await userEvent.click(dialog.getByRole("button", { name: "Abbrechen" }));
    await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
  },
};


export const CanResumeCleanupWhenItsPreviewFails: Story = {
  args: { apiClient: { requestJson: async (input: string) => input.endsWith("/disconnect")
    ? { response: new Response(null, { status: 503 }), body: { error: "Trennungsvorschau vorübergehend nicht erreichbar." } }
    : { response: new Response(null, { status: 200 }), body: { connection: { state: "connected" }, disconnectPending: true } },
  } as unknown as BrowserApiClient },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Bereinigung fortsetzen" })).toBeEnabled();
    await expect(canvas.getByText("Die Trennung ist noch nicht vollständig bestätigt. Setze die Bereinigung fort.")).toBeVisible();
  },
};
