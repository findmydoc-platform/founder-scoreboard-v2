"use client";

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningShellState, Profile, ProfileFeatureTourAcknowledgement, ViewMode } from "@/lib/types";
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
  data: PlanningShellState;
  openTaskPanel: (taskId: string) => void;
  selectedTaskId: string | null;
  setData: Dispatch<SetStateAction<PlanningShellState>>;
  setView: (view: ViewMode) => void;
  setWorkspace: (workspace: AppWorkspace) => void;
  source: "supabase";
  workspace: AppWorkspace;
};

type TourStatus = {
  kind: "error" | "loading";
  message: string;
} | null;

type FeatureTourResume = {
  stepIndex: number;
  tourId: string;
  view?: ViewMode;
};

const featureTourResumeStorageKey = "founderops.feature-tour.resume-v1";

function readFeatureTourResume(): FeatureTourResume | null {
  try {
    const raw = window.sessionStorage.getItem(featureTourResumeStorageKey);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<FeatureTourResume>;
    if (typeof value.tourId !== "string" || !Number.isInteger(value.stepIndex) || value.stepIndex! < 0) return null;
    if (value.view !== undefined && !["board", "structure", "table", "gantt"].includes(value.view)) return null;
    return { tourId: value.tourId, stepIndex: value.stepIndex!, view: value.view };
  } catch {
    return null;
  }
}

function clearFeatureTourResume() {
  try {
    window.sessionStorage.removeItem(featureTourResumeStorageKey);
  } catch {
    // A blocked session storage must not prevent a regular one-page tour.
  }
}

function persistFeatureTourResume(resume: FeatureTourResume) {
  try {
    window.sessionStorage.setItem(featureTourResumeStorageKey, JSON.stringify(resume));
    return true;
  } catch {
    return false;
  }
}

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
  data: PlanningShellState,
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
  openTaskPanel,
  selectedTaskId,
  setData,
  setView,
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
  const [resumeStepIndex, setResumeStepIndex] = useState(0);
  const [tourStatus, setTourStatus] = useState<TourStatus>(null);
  const startedTourRef = useRef("");
  const openTaskPanelRef = useRef(openTaskPanel);
  const selectedTaskIdRef = useRef(selectedTaskId);
  const tasksRef = useRef(data.tasks);

  useEffect(() => {
    openTaskPanelRef.current = openTaskPanel;
    selectedTaskIdRef.current = selectedTaskId;
    tasksRef.current = data.tasks;
  }, [data.tasks, openTaskPanel, selectedTaskId]);

  useEffect(() => {
    const resume = readFeatureTourResume();
    if (!resume) {
      clearFeatureTourResume();
      return;
    }
    const resumedTour = featureTours.find((definition) => definition.id === resume.tourId);
    if (!resumedTour || !resumedTour.steps[resume.stepIndex]) {
      clearFeatureTourResume();
      return;
    }
    const timeout = window.setTimeout(() => {
      clearFeatureTourResume();
      if (resume.view) setView(resume.view);
      setResumeStepIndex(resume.stepIndex);
      setRequestedTourId(resume.tourId);
      setTourStatus({ kind: "loading", message: "Hilfe-Tour wird fortgesetzt …" });
      setTourRequested(true);
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [setView, workspace]);

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
      clearFeatureTourResume();
      setResumeStepIndex(0);
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
      const startingStepIndex = resumeStepIndex;
      const tourSteps = activeTour.steps.slice(startingStepIndex);
      if (!tourSteps.length) {
        failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
        return;
      }

      if (
        startingStepIndex === 0
        && activeTour.startWorkspace
        && activeTour.startWorkspace !== workspace
      ) {
        const resumeStored = persistFeatureTourResume({
          tourId: activeTour.id,
          stepIndex: 0,
        });
        if (!resumeStored) {
          failTour("Hilfe-Tour konnte nicht fortgesetzt werden. Bitte versuche es erneut.");
          return;
        }
        setWorkspace(activeTour.startWorkspace);
        return;
      }

      if (startingStepIndex === 0 && activeTour.openTaskDetail) {
        const taskId = selectedTaskIdRef.current || tasksRef.current.find((task) => (
          !task.trashedAt
          && (!activeTour.openTaskShare || task.taskType === "deliverable" || task.taskType === "sub_issue")
        ))?.id;
        if (!taskId) {
          failTour("Für diese Hilfe-Tour wird mindestens ein Issue benötigt.");
          return;
        }
        openTaskPanelRef.current(taskId);
      }

      const initialStep = tourSteps[0];
      const initialSelector = startingStepIndex === 0
        ? activeTour.requiredSelectors[0]
        : typeof initialStep?.element === "string" ? initialStep.element : "";
      const trigger = initialSelector ? await waitForElement(initialSelector) : null;
      if (!runIsActive()) return;
      if (!trigger) {
        failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
        return;
      }

      if (startingStepIndex === 0 && activeTour.openTaskShare) {
        if (!(trigger instanceof HTMLElement)) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
        trigger.click();
        const sharePopover = await waitForElement(activeTour.requiredSelectors[1]);
        if (!runIsActive()) return;
        if (!sharePopover) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
      }

      if (startingStepIndex === 0 && activeTour.openAccountMenu) {
        window.dispatchEvent(new CustomEvent("fmd:open-account-menu"));
        const menuItem = await waitForElement(activeTour.requiredSelectors[1]);
        if (!runIsActive()) return;
        if (!menuItem) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
      }

      if (startingStepIndex === 0 && activeTour.openHelpMenu) {
        window.dispatchEvent(new CustomEvent("fmd:open-help-menu"));
        const menuItem = await waitForElement(activeTour.requiredSelectors[1]);
        if (!runIsActive()) return;
        if (!menuItem) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
      }

      if (startingStepIndex === 0 && activeTour.openProfileProcessSettings) {
        if (!(trigger instanceof HTMLElement)) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
        trigger.click();
        const settings = await waitForElement(activeTour.requiredSelectors[1]);
        if (!runIsActive()) return;
        if (!settings) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
      }

      if (startingStepIndex === 0 && activeTour.openProfileApiSettings) {
        if (!(trigger instanceof HTMLElement)) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
        trigger.click();
        const settings = await waitForElement(activeTour.requiredSelectors[1]);
        if (!runIsActive()) return;
        if (!settings) {
          failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
          return;
        }
      }

      const { driver } = await import("driver.js");
      if (!runIsActive()) return;
      let stepTransitionPending = false;
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
          setResumeStepIndex(0);
        },
        steps: tourSteps.map((step, index) => {
          const stepIndex = startingStepIndex + index;
          return ({
          ...step,
          popover: {
            ...step.popover,
            onPopoverRender: () => {
              if (stepIndex === 0) markSeen().catch(() => undefined);
            },
            onDoneClick: (_element, _step, opts) => {
              opts.driver.destroy();
              if (activeTour.doneWorkspace) {
                setWorkspace(activeTour.doneWorkspace);
              }
            },
            onNextClick: (_element, _step, opts) => {
              const transition = activeTour.stepTransitions?.[stepIndex];
              if (!transition) {
                opts.driver.moveNext();
                return;
              }
              if (stepTransitionPending) return;
              stepTransitionPending = true;
              void (async () => {
                const nextStepIndex = stepIndex + 1;
                const movesWorkspace = Boolean(transition.workspace && transition.workspace !== workspace);
                if (movesWorkspace) {
                  const resumeStored = persistFeatureTourResume({
                    tourId: activeTour.id,
                    stepIndex: nextStepIndex,
                    ...(transition.view ? { view: transition.view } : {}),
                  });
                  if (!resumeStored) {
                    opts.driver.destroy();
                    failTour("Hilfe-Tour konnte nicht fortgesetzt werden. Bitte versuche es erneut.");
                    return;
                  }
                  opts.driver.destroy();
                  setWorkspace(transition.workspace!);
                  return;
                }
                if (transition.view) setView(transition.view);
                const nextStep = activeTour.steps[nextStepIndex];
                const nextSelector = typeof nextStep?.element === "string" ? nextStep.element : "";
                const target = nextSelector ? await waitForElement(nextSelector) : null;
                if (!runIsActive()) return;
                if (!target) {
                  opts.driver.destroy();
                  failTour("Hilfe-Tour konnte nicht vorbereitet werden. Bitte versuche es erneut.");
                  return;
                }
                opts.driver.moveNext();
              })().finally(() => {
                stepTransitionPending = false;
              });
            },
          },
          });
        }),
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
  }, [apiClient, currentProfile, resumeStepIndex, setData, setView, setWorkspace, source, tour, tourRequested, workspace]);

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
