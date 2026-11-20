import { useState, type ComponentProps } from "react";
import type { PlanningPromptTemplate, PlanningPromptTemplateEdit } from "@/features/planning-items/model/planning-prompt-templates";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { sessionAuthority } from "@/features/administrator-access/model/administrator-access";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";
import type { AuthorityCapabilities } from "@/features/administrator-access/model/administrator-access";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { AdministrationWorkspaceHost } from "./administration-workspace-host";
import { administrationStoryModel } from "./administration-workspace.stories";

const capabilities: AuthorityCapabilities = {
  technicalAdministration: true,
  manageAdministratorEligibility: true,
  operationalCorrection: true,
  ceoGovernance: false,
};

function apiClientWith(result: { response: Response; body: unknown }) {
  return {
    requestJson: fn(async () => result),
    requestForm: fn(),
    requestBlob: fn(),
  } as unknown as BrowserApiClient;
}

function HostWithOwner(props: Omit<ComponentProps<typeof AdministrationWorkspaceHost>, "planningState">) {
 const [owner] = useState(() => createPlanningState({userId:"story",initialData:emptyPlanningShellState,initialAdministrationAuthority:sessionAuthority({platformRole:props.capabilities.ceoGovernance?"ceo":"founder",credentialKind:"session",administratorAccess:{eligible:true,active:true,expiresAt:new Date(Date.now()+3600000).toISOString()}}),adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,readAdministration:async()=>{const {response,body}=await props.apiClient.requestJson<{administration?:import("../model/administration-read-model").AdministrationWorkspaceModel;error?:string;code?:string}>("/api/administration-data",{useDevProfileOverride:false});if(!response.ok||!body?.administration)throw Object.assign(new Error(body?.error||"Unavailable"),{status:response.status,code:body?.code});return body.administration;}}}));
 return <AdministrationWorkspaceHost {...props} planningState={owner.planning}/>;
}

const meta = {
  component: HostWithOwner,
  parameters: { layout: "fullscreen" },
  tags: ["layer:organism", "status:stable"],
  title: "Administration/Organisms/AdministrationWorkspaceHost",
  args: {
    apiClient: apiClientWith({
      response: Response.json({ administration: administrationStoryModel }),
      body: { administration: administrationStoryModel },
    }),
    capabilities,
    initialModel: null,
    onAdministratorAccessInvalid: fn(),
  },
} satisfies Meta<typeof HostWithOwner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LoadsOnMount: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Aufmerksamkeit erforderlich" })).toBeInTheDocument();
    await expect(args.apiClient.requestJson).toHaveBeenCalledWith(
      "/api/administration-data",
      { useDevProfileOverride: false },
    );
  },
};

export const ClearsOnAuthorityLoss: Story = {
  args: {
    apiClient: apiClientWith({
      response: Response.json({
        code: "administrator_access_expired",
        error: "Der Adminzugang ist abgelaufen.",
      }, { status: 403 }),
      body: {
        code: "administrator_access_expired",
        error: "Der Adminzugang ist abgelaufen.",
      },
    }),
    initialModel: administrationStoryModel,
    onAdministratorAccessInvalid: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Der Administrationszugang ist nicht mehr gültig.")).toBeInTheDocument();
    await expect(args.onAdministratorAccessInvalid).toHaveBeenCalled();
  },
};

const promptTemplates: PlanningPromptTemplate[] = [
  { kind: "general", text: "Verwende kurze Absätze.", version: 1 },
  { kind: "initiative", text: "Beschreibe die gewünschte Wirkung.", version: 1 },
  { kind: "deliverable", text: "Formuliere überprüfbare Ergebnisse.", version: 1 },
  { kind: "sub_issue", text: "Beschreibe einen konkreten Arbeitsschritt.", version: 1 },
];

function promptTemplatesClient() {
  let templates = promptTemplates;
  let rejectNextPublish = true;
  const result = (body: unknown, status = 200) => ({ response: Response.json(body, { status }), body });
  return {
    requestJson: fn(async (path: string, options?: { method?: string; json?: PlanningPromptTemplateEdit }) => {
      if (path === "/api/administration-data") return result({ administration: administrationStoryModel });
      if (options?.method !== "PUT") return result({ profileId: "prompt-templates-story", templates });
      if (rejectNextPublish) {
        rejectNextPublish = false;
        return result({ error: "Prompt-Vorlage konnte nicht veröffentlicht werden." }, 503);
      }
      const edit = options.json!;
      const template = { kind: edit.kind, text: edit.text, version: edit.expectedVersion + 1 };
      templates = templates.map(current => current.kind === template.kind ? template : current);
      return result({ template });
    }),
    requestForm: fn(),
    requestBlob: fn(),
  } as unknown as BrowserApiClient;
}

export const PromptTemplateDraftAndPublish: Story = {
  render: args => <HostWithOwner {...args} apiClient={promptTemplatesClient()} />,
  play: async ({ canvasElement, userEvent }) => {
    const canvas = within(canvasElement);
    const openTemplates = async () => {
      await userEvent.click(await canvas.findByRole("tab", { name: "Prompt-Vorlagen" }));
    };
    const labels = ["Allgemeine Prompt-Vorlage", "Prompt-Vorlage für Initiativen", "Prompt-Vorlage für Deliverables", "Prompt-Vorlage für Sub-Issues"];
    const editor = async (label: string) => within(await canvas.findByRole("region", { name: label }));
    const enterDraft = async (label: string, draft: string) => {
      const input = (await editor(label)).getByRole("textbox", { name: label });
      await userEvent.clear(input);
      await userEvent.type(input, draft);
    };
    const initiativeDraft = "Benenne Ziel und Erfolgskriterien.";
    const deliverableDraft = "Beschreibe das überprüfbare Ergebnis.";
    const localDraftNotice = "Entwurf auf diesem Gerät gespeichert.";

    try {
      await openTemplates();
      for (const [index, label] of labels.entries()) {
        await expect((await editor(label)).getByRole("textbox", { name: label })).toHaveValue(promptTemplates[index].text);
      }
      await enterDraft(labels[1], initiativeDraft);
      await enterDraft(labels[2], deliverableDraft);
      await userEvent.click(canvas.getByRole("tab", { name: "Übersicht" }));
      await openTemplates();
      const deliverable = await editor(labels[2]);
      await expect((await editor(labels[1])).getByRole("textbox")).toHaveValue(initiativeDraft);
      await expect(deliverable.getByRole("textbox")).toHaveValue(deliverableDraft);

      await userEvent.click(deliverable.getByRole("button", { name: "Veröffentlichen" }));
      await expect(await deliverable.findByRole("alert")).toHaveTextContent("Prompt-Vorlage konnte nicht veröffentlicht werden.");
      await expect(deliverable.getByText("Aktive Fassung 1")).toBeInTheDocument();
      await expect(deliverable.getByRole("textbox")).toHaveValue(deliverableDraft);
      await userEvent.click(deliverable.getByRole("button", { name: "Veröffentlichen" }));
      await expect(await deliverable.findByText("Aktive Fassung 2")).toBeInTheDocument();

      await userEvent.click(canvas.getByRole("tab", { name: "Übersicht" }));
      await openTemplates();
      const published = await editor(labels[2]);
      await expect(published.getByRole("textbox")).toHaveValue(deliverableDraft);
      await expect(published.getByRole("button", { name: "Veröffentlichen" })).toBeDisabled();
      await expect(published.queryByText(localDraftNotice)).not.toBeInTheDocument();
      const initiative = await editor(labels[1]);
      await expect(initiative.getByText("Aktive Fassung 1")).toBeInTheDocument();
      await expect(initiative.getByRole("textbox")).toHaveValue(initiativeDraft);
      await expect(initiative.getByText(localDraftNotice)).toBeInTheDocument();
      for (const index of [0, 3]) {
        const unchanged = await editor(labels[index]);
        await expect(unchanged.getByText("Aktive Fassung 1")).toBeInTheDocument();
        await expect(unchanged.getByRole("textbox")).toHaveValue(promptTemplates[index].text);
      }
    } finally {
      for (const template of promptTemplates) window.localStorage.removeItem(`founderops:planning-prompt-draft:prompt-templates-story:${template.kind}`);
    }
  },
};
