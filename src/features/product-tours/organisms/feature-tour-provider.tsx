"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Profile, ProfileFeatureTourAcknowledgement } from "@/lib/types";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { featureTours } from "@/features/product-tours/model/feature-tour-registry";
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
  const tour = useMemo(() => {
    if (!currentProfile) return undefined;
    return selectNextFeatureTour(featureTours, workspace, currentProfile.id, data.profileFeatureTourAcknowledgements);
  }, [currentProfile, data.profileFeatureTourAcknowledgements, workspace]);
  const [tourRequested, setTourRequested] = useState(false);
  const startedTourRef = useRef("");

  useEffect(() => {
    const startFeatureTour = () => setTourRequested(true);
    window.addEventListener("fmd:start-feature-tour", startFeatureTour);
    return () => window.removeEventListener("fmd:start-feature-tour", startFeatureTour);
  }, []);

  useEffect(() => {
    if (!tourRequested || !tour || !currentProfile || startedTourRef.current === tour.id) return;
    const activeTour = tour;
    let active = true;
    let seenMarked = false;
    startedTourRef.current = activeTour.id;

    const markSeen = async () => {
      if (seenMarked || !active) return;
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
      if (!active || !trigger) {
        startedTourRef.current = "";
        setTourRequested(false);
        return;
      }

      if (activeTour.openAccountMenu) {
        window.dispatchEvent(new CustomEvent("fmd:open-account-menu"));
        const menuItem = await waitForElement(activeTour.requiredSelectors[1]);
        if (!active || !menuItem) {
          startedTourRef.current = "";
          setTourRequested(false);
          return;
        }
      }

      const { driver } = await import("driver.js");
      if (!active) return;
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

      driverObject.drive();
      setTourRequested(false);
    }

    startTour().catch(() => {
      startedTourRef.current = "";
      setTourRequested(false);
    });

    return () => {
      active = false;
    };
  }, [apiClient, currentProfile, setData, setWorkspace, source, tour, tourRequested]);

  return null;
}
