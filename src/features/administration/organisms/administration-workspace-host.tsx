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

export function AdministrationWorkspaceHost({ apiClient, planningState, capabilities, initialModel, onAdministratorAccessInvalid }: {
  apiClient: BrowserApiClient;
  planningState: import("@/features/planning/model/planning-state").PlanningState;
  capabilities: AuthorityCapabilities;
  initialModel?: AdministrationWorkspaceModel | null;
  onAdministratorAccessInvalid: () => void;
}) {
  const controller = useAdministrationWorkspaceController({
    apiClient,
    planningState,
    capabilities,
    initialModel,
    onAdministratorAccessInvalid,
  });
  const technical = Boolean(controller.model && planningState.administration().coverage.technical && controller.capabilities.technicalAdministration);
  const [activeTab, setActiveTab] = useState<AdministrationTab>(capabilities.technicalAdministration ? "overview" : "people");
  const visibleTab = technical ? activeTab : "people";
  const visibleTabs: AdministrationTab[] = technical ? ["overview", "people", "integrations"] : ["people"];
  const { model } = controller;

  if (!controller.capabilities.manageAdministratorEligibility) {
    return <UiEmptyState tone="warning" minHeight="md">Für Administration ist eine CEO-Sitzung oder ein aktiver Adminzugang erforderlich.</UiEmptyState>;
  }
  if (planningState.administration().readStatus === "forbidden") return <UiEmptyState tone="warning" minHeight="md">Der Administrationszugang ist nicht mehr gültig.</UiEmptyState>;
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
          planningState={planningState}
        />
      )}
      {visibleTab === "integrations" && technical && (
        <IntegrationsDeliveryAdministration
          busy={controller.busy}
          model={model}
          planningState={planningState}
        />
      )}
    </AdministrationWorkspaceTemplate>
  );
}
