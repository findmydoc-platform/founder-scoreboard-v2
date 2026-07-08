"use client";

import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { driver } from "driver.js";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Profile, ProfileFeatureTourAcknowledgement } from "@/lib/types";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { featureTours } from "@/features/product-tours/model/feature-tour-registry";

type FeatureTourProviderProps = {
  apiClient: BrowserApiClient;
  currentProfile: Profile | null;
  data: PlanningData;
  setData: Dispatch<SetStateAction<PlanningData>>;
  setWorkspace: (workspace: AppWorkspace) => void;
  source: "seed" | "supabase";
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
}: FeatureTourProviderProps) {
  const tour = useMemo(() => {
    if (!currentProfile) return undefined;
    return featureTours.find((item) =>
      !data.profileFeatureTourAcknowledgements.some((acknowledgement) =>
        acknowledgement.profileId === currentProfile.id && acknowledgement.tourId === item.id
      )
    );
  }, [currentProfile, data.profileFeatureTourAcknowledgements]);
  const startedTourRef = useRef("");

  useEffect(() => {
    if (!tour || !currentProfile || startedTourRef.current === tour.id) return;
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
      if ("targetWorkspace" in activeTour && activeTour.targetWorkspace) {
        setWorkspace(activeTour.targetWorkspace);
      }

      const trigger = await waitForElement(activeTour.requiredSelectors[0]);
      if (!active || !trigger) {
        startedTourRef.current = "";
        return;
      }

      if ("openAccountMenu" in activeTour && activeTour.openAccountMenu) {
        window.dispatchEvent(new CustomEvent("fmd:open-account-menu"));
        const menuItem = await waitForElement(activeTour.requiredSelectors[1]);
        if (!active || !menuItem) {
          startedTourRef.current = "";
          return;
        }
      }

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
              if ("doneWorkspace" in activeTour && activeTour.doneWorkspace) {
                setWorkspace(activeTour.doneWorkspace);
              }
            },
          },
        })),
      });

      driverObject.drive();
    }

    startTour().catch(() => {
      startedTourRef.current = "";
    });

    return () => {
      active = false;
    };
  }, [apiClient, currentProfile, setData, setWorkspace, source, tour]);

  return null;
}
