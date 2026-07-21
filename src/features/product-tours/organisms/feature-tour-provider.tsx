"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Profile, ProfileFeatureTourAcknowledgement } from "@/lib/types";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import * as planningApi from "@/features/planning/model/planning-api-client";
import {
  featureTours,
  type FeatureTourDefinition,
} from "@/features/product-tours/model/feature-tour-registry";
import {
  shouldReleaseFeatureTourClaim,
  type FeatureTourRunClaim,
} from "@/features/product-tours/model/feature-tour-run-state";
import { selectNextFeatureTour } from "@/features/product-tours/model/feature-tour-selection";

type FeatureTourProviderProps = {
  apiClient: BrowserApiClient;
  currentProfile: Profile | null;
  data: PlanningData;
  setData: Dispatch<SetStateAction<PlanningData>>;
  setWorkspace: (workspace: AppWorkspace) => void;
  source: "seed" | "supabase";
  workspace: AppWorkspace;
};

type TourStatus = {
  kind: "error" | "loading";
  message: string;
} | null;

function waitForElement(selector: string, timeoutMs = 8000) {
  const existing = document.querySelector(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise<Element | null>((resolve) => {
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      const element = document.querySelector(selector);
      if (!element) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(element);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function upsertAcknowledgement(
  data: PlanningData,
  acknowledgement: ProfileFeatureTourAcknowledgement,
) {
  return {
    ...data,
    profileFeatureTourAcknowledgements: data.profileFeatureTourAcknowledgements.some((item) =>
      item.profileId === acknowledgement.profileId && item.tourId === acknowledgement.tourId
    )
      ? data.profileFeatureTourAcknowledgements.map((item) =>
        item.profileId === acknowledgement.profileId && item.tourId === acknowledgement.tourId ? acknowledgement : item,
      )
      : [acknowledgement, ...data.profileFeatureTourAcknowledgements],
  };
}

export function FeatureTourProvider({
  apiClient,
  currentProfile,
  data,
  setData,
  setWorkspace,
  source,
  workspace,
}: FeatureTourProviderProps) {
  const nextTour = useMemo(() => {
    if (!currentProfile) return undefined;
    return selectNextFeatureTour(featureTours, workspace, currentProfile.id, data.profileFeatureTourAcknowledgements);
  }, [currentProfile, data.profileFeatureTourAcknowledgements, workspace]);
  const [requestedTourId, setRequestedTourId] = useState<string | null>(null);
  const tour: FeatureTourDefinition | undefined = requestedTourId
    ? featureTours.find((definition) => definition.id === requestedTourId)
    : nextTour;
  const [tourRequested, setTourRequested] = useState(false);
  const [tourStatus, setTourStatus] = useState<TourStatus>(null);
  const startedTourRef = useRef("");

  useEffect(() => {
    const startFeatureTour = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { tourId?: unknown } | undefined : undefined;
      const explicitTourId = typeof detail?.tourId === "string" ? detail.tourId : "";
      const selectedTour: FeatureTourDefinition | undefined = explicitTourId
        ? featureTours.find((definition) => definition.id === explicitTourId)
        : nextTour;
      if (!selectedTour) {
        setTourRequested(false);
        setTourStatus({
          kind: "error",
          message: explicitTourId ? "Diese Hilfe-Tour ist nicht verfügbar." : "Keine neue Hilfe-Tour verfügbar.",
        });
        return;
      }
      if (startedTourRef.current === selectedTour.id) return;
      setRequestedTourId(selectedTour.id);
      setTourStatus({ kind: "loading", message: "Hilfe-Tour wird vorbereitet …" });
      setTourRequested(true);
    };
    window.addEventListener("fmd:start-feature-tour", startFeatureTour);
    return () => window.removeEventListener("fmd:start-feature-tour", startFeatureTour);
  }, [nextTour]);

  useEffect(() => {
    if (tourStatus?.kind !== "error") return;
    const timeout = window.setTimeout(() => setTourStatus(null), 8000);
    return () => window.clearTimeout(timeout);
  }, [tourStatus]);

  useEffect(() => {
    if (!tourRequested || !tour || startedTourRef.current === tour.id) return;
    const activeTour = tour;
    let active = true;
    let seenMarked = false;
    const run: FeatureTourRunClaim = {
      driverStarted: false,
      tourId: activeTour.id,
    };
    startedTourRef.current = activeTour.id;

    const runIsActive = () => active;

    const failTour = (message: string) => {
      if (!runIsActive()) return;
      if (startedTourRef.current === activeTour.id) startedTourRef.current = "";
      setRequestedTourId(null);
      setTourRequested(false);
      setTourStatus({ kind: "error", message });
    };

    const markSeen = async () => {
      if (seenMarked || !runIsActive() || !currentProfile) return;
      seenMarked = true;
      if (source !== "supabase") {
        setData((current) => upsertAcknowledgement(current, {
          profileId: currentProfile.id,
          tourId: activeTour.id,
          seenAt: new Date().toISOString(),
        }));
        return;
      }
      const { response, body } = await planningApi.markProfileFeatureTourSeenRequest(apiClient, activeTour.id);
      if (response.ok && body?.acknowledgement) {
        setData((current) => upsertAcknowledgement(current, body.acknowledgement!));
      }
    };

    async function startTour() {
      if (activeTour.startWorkspace) {
        setWorkspace(activeTour.startWorkspace);
      }

      const trigger = await waitForElement(activeTour.requiredSelectors[0]);
      if (!runIsActive()) return;
      if (!trigger) {
        failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
        return;
      }

      if (activeTour.openAccountMenu) {
        window.dispatchEvent(new CustomEvent("fmd:open-account-menu"));
        const menuItem = await waitForElement(activeTour.requiredSelectors[1]);
        if (!runIsActive()) return;
        if (!menuItem) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
      }

      if (activeTour.openHelpMenu) {
        window.dispatchEvent(new CustomEvent("fmd:open-help-menu"));
        const menuItem = await waitForElement(activeTour.requiredSelectors[1]);
        if (!runIsActive()) return;
        if (!menuItem) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
      }

      const { driver } = await import("driver.js");
      if (!runIsActive()) return;
      const driverObject = driver({
        allowClose: true,
        animate: true,
        doneBtnText: "Fertig",
        nextBtnText: "Weiter",
        prevBtnText: "Zurück",
        showButtons: ["next", "close"],
        showProgress: true,
        stagePadding: 6,
        stageRadius: 8,
        onDestroyed: () => {
          if (startedTourRef.current === activeTour.id) startedTourRef.current = "";
          setRequestedTourId(null);
        },
        steps: activeTour.steps.map((step, index) => ({
          ...step,
          popover: {
            ...step.popover,
            onPopoverRender: () => {
              if (index === 0) markSeen().catch(() => undefined);
            },
            onDoneClick: (_element, _step, opts) => {
              opts.driver.destroy();
              if (activeTour.doneWorkspace) {
                setWorkspace(activeTour.doneWorkspace);
              }
            },
          },
        })),
      });

      run.driverStarted = true;
      driverObject.drive();
      setTourRequested(false);
      setTourStatus(null);
    }

    startTour().catch(() => {
      failTour("Hilfe-Tour konnte nicht geladen werden. Bitte versuche es erneut.");
    });

    return () => {
      active = false;
      if (shouldReleaseFeatureTourClaim(run, startedTourRef.current)) {
        startedTourRef.current = "";
      }
    };
  }, [apiClient, currentProfile, setData, setWorkspace, source, tour, tourRequested]);

  if (!tourStatus) return null;

  return (
    <div
      role={tourStatus.kind === "error" ? "alert" : "status"}
      aria-live={tourStatus.kind === "error" ? "assertive" : "polite"}
      aria-busy={tourStatus.kind === "loading"}
      className={`fixed bottom-5 right-5 z-[70] max-w-sm rounded-lg border px-4 py-3 text-sm font-medium shadow-xl ${
        tourStatus.kind === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : "border-blue-200 bg-white text-slate-700"
      }`}
    >
      <span
        aria-hidden="true"
        className={`mr-3 inline-block h-2.5 w-2.5 rounded-full ${
          tourStatus.kind === "loading" ? "animate-pulse bg-blue-500" : "bg-red-500"
        }`}
      />
      {tourStatus.message}
    </div>
  );
}
