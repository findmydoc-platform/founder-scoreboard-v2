"use client";

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { usePlanningBusinessState } from "@/features/planning/hooks/use-planning-business-state";
import { unloadedPlatformReleaseReferences, type PlatformReleaseContent } from "../model/platform-release-model";
import { PlatformReleaseDetail } from "./platform-release-detail";

const subscribeWithoutOwner = () => () => undefined;
const noInitialReferences = () => unloadedPlatformReleaseReferences;

export function PlatformReleaseOwnedDetail({ release, technicalInitiallyOpen, serverEntryId, children }: { release: PlatformReleaseContent; technicalInitiallyOpen?: boolean; serverEntryId?: string; children?: ReactNode }) {
  const planning = usePlanningBusinessState();
  const router = useRouter();
  const visibleScope = useRef<symbol>(undefined);
  const { version, manifestDigest } = release;
  const references = useSyncExternalStore(
    planning?.subscribe || subscribeWithoutOwner,
    () => planning?.releasePlanningReferences({ version, manifestDigest }) || unloadedPlatformReleaseReferences,
    noInitialReferences,
  );
  useEffect(() => {
    if (references.status === "not-loaded" && document.visibilityState === "visible") {
      void planning?.loadReleasePlanningReferences({ version, manifestDigest });
    }
  }, [planning, version, manifestDigest, references.status]);
  useEffect(() => {
    if (!planning) return;
    const key = { version, manifestDigest };
    const scope = Symbol();
    visibleScope.current = scope;
    let controller: AbortController | undefined;
    let interval: number | undefined;
    const stop = () => {
      controller?.abort();
      controller = undefined;
      if (interval !== undefined) window.clearInterval(interval);
      interval = undefined;
      planning.cancelReleasePlanningReferences(key);
    };
    const check = () => {
      if (document.visibilityState !== "visible") { stop(); return; }
      controller ||= new AbortController();
      interval ??= window.setInterval(check, 60_000);
      if (planning.releasePlanningReferences(key).status === "not-loaded") void planning.loadReleasePlanningReferences(key);
      else void planning.checkReleasePlanningReferences(key, controller.signal);
    };
    check();
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", check);
      window.removeEventListener("online", check);
      // Strict Mode immediately reattaches the same view. Route departure does not.
      if (serverEntryId) queueMicrotask(() => {
        if (visibleScope.current === scope) planning.cancelReleaseReferenceEntry(serverEntryId);
      });
    };
  }, [planning, version, manifestDigest, serverEntryId]);
  return <><PlatformReleaseDetail
    release={release} technicalInitiallyOpen={technicalInitiallyOpen} referenceState={references}
    onRetryReferences={() => { void planning?.loadReleasePlanningReferences({ version, manifestDigest }); }}
    onReloadRelease={() => router.refresh()}
  />{children}</>;
}
