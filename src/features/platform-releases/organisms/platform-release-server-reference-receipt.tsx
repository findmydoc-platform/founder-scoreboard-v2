"use client";

import { useEffect } from "react";
import { usePlanningBusinessState } from "@/features/planning/hooks/use-planning-business-state";
import type { PlatformReleaseReferenceEntryOutcome } from "../model/platform-release-model";

export function PlatformReleaseServerReferenceReceipt({ id, result }: { id: string; result: PromiseLike<PlatformReleaseReferenceEntryOutcome> }) {
  const owner = usePlanningBusinessState();
  useEffect(() => {
    if (!owner) return;
    let active = true;
    const deliver = (outcome: PlatformReleaseReferenceEntryOutcome) => {
      if (active) owner.acceptReleaseReferenceEntry(id, outcome);
    };
    // Flight supplies a thenable. Use a native promise to normalize delivery.
    void Promise.resolve(result).then(deliver, () => deliver({ status: "unavailable" }));
    return () => { active = false; };
  }, [owner, id, result]);
  return null;
}
