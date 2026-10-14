"use client";

import { useState } from "react";
import { AdministrationOverview } from "@/features/administration/organisms/administration-overview";
import { IntegrationsDeliveryAdministration } from "@/features/administration/organisms/integrations-delivery-administration";
import { PeopleAccessAdministration } from "@/features/administration/organisms/people-access-administration";
import { AdministrationWorkspaceTemplate, type AdministrationTab } from "@/features/administration/templates/administration-workspace-template";
import { useAdministrationWorkspaceController } from "@/features/administration/hooks/use-administration-workspace-controller";
import type { AuthorityCapabilities } from "@/features/administrator-access/model/administrator-access";
import type { AdministrationWorkspaceModel } from "@/features/administration/model/administration-read-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { UiEmptyState, UiNotice } from "@/shared/atoms/ui-primitives";

export function AdministrationWorkspaceHost({ apiClient, capabilities, initialModel, onAdministratorAccessInvalid }: {
  apiClient: BrowserApiClient;
  capabilities: AuthorityCapabilities;
  initialModel?: AdministrationWorkspaceModel | null;
  onAdministratorAccessInvalid: () => void;
}) {
  const controller = useAdministrationWorkspaceController({
    apiClient,
    capabilities,
    initialModel,
    onAdministratorAccessInvalid,
  });
  const technical = controller.capabilities.technicalAdministration;
  const [activeTab, setActiveTab] = useState<AdministrationTab>(technical ? "overview" : "people");
  const visibleTab = technical ? activeTab : "people";
  const visibleTabs: AdministrationTab[] = technical ? ["overview", "people", "integrations"] : ["people"];
  const { model } = controller;

  if (!controller.capabilities.manageAdministratorEligibility) {
    return <UiEmptyState tone="warning" minHeight="md">Für Administration ist eine CEO-Sitzung oder ein aktiver Adminzugang erforderlich.</UiEmptyState>;
  }
  if (!model) {
    return <UiEmptyState minHeight="md">Administrationsdaten werden geladen.</UiEmptyState>;
  }

  return (
    <AdministrationWorkspaceTemplate activeTab={visibleTab} visibleTabs={visibleTabs} onTabChange={setActiveTab}>
      {controller.message && <UiNotice tone="warning">{controller.message}</UiNotice>}
      {visibleTab === "overview" && technical && <AdministrationOverview model={model} onNavigate={setActiveTab} onRefresh={() => void controller.load()} />}
      {visibleTab === "people" && (
        <PeopleAccessAdministration
          busy={controller.busy}
          model={model}
          showTechnicalIdentity={technical}
          onSavePerson={(profileId, patch) => {
            const person = model.people.find((candidate) => candidate.id === profileId);
            return person ? controller.savePerson(person, patch) : Promise.resolve();
          }}
        />
      )}
      {visibleTab === "integrations" && technical && (
        <IntegrationsDeliveryAdministration
          key={`${model.githubProject?.owner || ""}:${model.githubProject?.number || 0}`}
          busy={controller.busy}
          model={model}
          onDeliver={controller.deliverNotifications}
          onSaveGitHubProject={controller.saveGitHubProject}
        />
      )}
    </AdministrationWorkspaceTemplate>
  );
}
