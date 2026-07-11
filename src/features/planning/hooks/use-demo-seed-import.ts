"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { persistLocalPlanningData } from "@/features/planning/hooks/use-local-planning-state";
import { importDemoSeedRequest } from "@/features/planning/model/planning-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { seedData } from "@/lib/seed";
import type { PlanningData } from "@/lib/types";
import { resolveNotificationEvents } from "@/lib/notification-resolution";

export function useDemoSeedImport({
  apiClient,
  setData,
  setSaveError,
  source,
}: {
  apiClient: BrowserApiClient;
  setData: Dispatch<SetStateAction<PlanningData>>;
  setSaveError: Dispatch<SetStateAction<string>>;
  source: "seed" | "supabase";
}) {
  const [demoSeedImportPending, setDemoSeedImportPending] = useState(false);

  const importIntoBrowser = useCallback(() => {
    const reconciledSeedData = resolveNotificationEvents(seedData).data;
    persistLocalPlanningData(reconciledSeedData);
    setData(reconciledSeedData);
  }, [setData]);

  const importDemoSeed = useCallback(async () => {
    if (demoSeedImportPending) return;

    setSaveError("");
    setDemoSeedImportPending(true);

    if (source === "seed") {
      importIntoBrowser();
      setDemoSeedImportPending(false);
      return;
    }

    try {
      const { response, body } = await importDemoSeedRequest(apiClient);
      if (response.ok) {
        window.location.reload();
        return;
      }

      throw new Error(body?.error || "Demo-Import konnte nicht ausgeführt werden.");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Demo-Import konnte nicht ausgeführt werden.");
      setDemoSeedImportPending(false);
    }
  }, [apiClient, demoSeedImportPending, importIntoBrowser, setSaveError, source]);

  return {
    demoSeedImportPending,
    importDemoSeed,
  };
}
