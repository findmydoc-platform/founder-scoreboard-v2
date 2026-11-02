"use client";

import { useEffect, useEffectEvent } from "react";
import type { ApplicationNavigation } from "../model/application-header";

export function useApplicationHelpNavigation(navigation: ApplicationNavigation) {
  const navigate = useEffectEvent(navigation.navigate);
  useEffect(() => {
    let active = true;
    const continueInPlanning = (event: Event) => {
      queueMicrotask(() => {
        if (!active || event.defaultPrevented) return;
        const params = new URLSearchParams({ help: event.type === "fmd:start-feature-tour" ? "tour" : "updates" });
        const tourId = (event as CustomEvent<{ tourId?: unknown }>).detail?.tourId;
        if (typeof tourId === "string" && tourId) params.set("tourId", tourId);
        navigate(`/planning?${params}`);
      });
    };
    window.addEventListener("fmd:start-feature-tour", continueInPlanning);
    window.addEventListener("fmd:open-product-updates", continueInPlanning);

    const params = new URLSearchParams(window.location.search);
    const request = params.get("help");
    if (window.location.pathname === "/planning" && (request === "tour" || request === "updates")) {
      const tourId = params.get("tourId") || undefined;
      params.delete("help");
      params.delete("tourId");
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
      queueMicrotask(() => {
        if (active) window.dispatchEvent(new CustomEvent(request === "tour" ? "fmd:start-feature-tour" : "fmd:open-product-updates", { cancelable: true, detail: { tourId } }));
      });
    }
    return () => {
      active = false;
      window.removeEventListener("fmd:start-feature-tour", continueInPlanning);
      window.removeEventListener("fmd:open-product-updates", continueInPlanning);
    };
  }, []);
}
