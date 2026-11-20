import { useState, type ComponentProps } from "react";
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

const initialPromptTemplate = { kind: "general", text: "Verwende kurze Absätze.", version: 1 };

function promptTemplatesClient() {
  let template = initialPromptTemplate;
  let rejectNextPublish = true;
  const result = (body: unknown, status = 200) => ({ response: Response.json(body, { status }), body });
  return {
    requestJson: fn(async (path: string, options?: { method?: string; json?: { text: string } }) => {
      if (path === "/api/administration-data") return result({ administration: administrationStoryModel });
      if (options?.method !== "PUT") return result({ profileId: "prompt-templates-story", templates: [template] });
      if (rejectNextPublish) {
        rejectNextPublish = false;
        return result({ error: "Prompt-Vorlage konnte nicht veröffentlicht werden." }, 503);
      }
      template = { ...template, text: options.json!.text, version: 2 };
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
      return await canvas.findByRole("textbox", { name: "Allgemeine Prompt-Vorlage" });
    };
    const draft = "Beschreibe das überprüfbare Ergebnis.";
    const editor = await openTemplates();
    await expect(editor).toHaveValue(initialPromptTemplate.text);
    await userEvent.clear(editor);
    await userEvent.type(editor, draft);
    await userEvent.click(canvas.getByRole("tab", { name: "Übersicht" }));
    await expect(await openTemplates()).toHaveValue(draft);

    await userEvent.click(canvas.getByRole("button", { name: "Veröffentlichen" }));
    await expect(await canvas.findByText("Prompt-Vorlage konnte nicht veröffentlicht werden.")).toBeInTheDocument();
    await expect(canvas.getByText("Aktive Fassung 1")).toBeInTheDocument();
    await expect(canvas.getByRole("textbox", { name: "Allgemeine Prompt-Vorlage" })).toHaveValue(draft);

    await userEvent.click(canvas.getByRole("button", { name: "Veröffentlichen" }));
    await expect(await canvas.findByText("Aktive Fassung 2")).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("tab", { name: "Übersicht" }));
    await expect(await openTemplates()).toHaveValue(draft);
    await expect(canvas.getByRole("button", { name: "Veröffentlichen" })).toBeDisabled();
    await expect(canvas.queryByText("Entwurf auf diesem Gerät gespeichert.")).not.toBeInTheDocument();
  },
};
