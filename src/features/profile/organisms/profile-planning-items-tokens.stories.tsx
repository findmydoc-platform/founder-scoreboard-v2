import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { ProfilePlanningItemsTokens } from "./profile-planning-items-tokens";

function Fixture({ lost = false }: { lost?: boolean }) {
  const [owner] = useState(() => createPlanningState({ userId: "account-a", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: emptyPlanningShellState }),
    readProfileApiTokens: async () => ({ tokens: [], canIssueEmptyEpicDeletes: false }),
    issueProfileApiToken: async () => { if (lost) throw new Error("Die Token-Erstellung ist noch nicht bestätigt."); return { token: "synthetic-one-time-token", tokenRecord: { id: "token-a", label: "Automation", expiresAt: "2099-01-01", scopes: [] } as never }; },
  } }));
  return <div className="p-4"><button onClick={() => owner.internal.sessionChanged(null)}>Sitzung beenden</button><ProfilePlanningItemsTokens planningState={owner.planning} source="supabase" /></div>;
}
const meta = { title: "Features/Profile/ProfilePlanningItemsTokens", component: Fixture, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Fixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ClearsOneTimeSecretOnLogout: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole("textbox", { name: "Token-Bezeichnung" }), "Automation");
    await userEvent.click(canvas.getByRole("button", { name: "Token erstellen" }));
    await expect(await canvas.findByText("synthetic-one-time-token")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Sitzung beenden" }));
    await expect(canvas.queryByText("synthetic-one-time-token")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Automation")).not.toBeInTheDocument();
  },
};
export const DoesNotRetryAnUncertainIssuance: Story = {
  args: { lost: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(await canvas.findByRole("textbox", { name: "Token-Bezeichnung" }), "Automation");
    await userEvent.click(canvas.getByRole("button", { name: "Token erstellen" }));
    await expect(await canvas.findByText("Die Token-Erstellung ist noch nicht bestätigt.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Token erstellen" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Aktualisieren" }));
    await expect(canvas.getByRole("button", { name: "Token erstellen" })).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: "Token-Bezeichnung" })).toHaveValue("Automation");
  },
};
