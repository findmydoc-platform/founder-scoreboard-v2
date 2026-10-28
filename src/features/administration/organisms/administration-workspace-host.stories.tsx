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
