"use client";

import {
  useFeatureTour,
  type FeatureTourProviderProps,
} from "@/features/product-tours/hooks/use-feature-tour";

export function FeatureTourProvider(props: FeatureTourProviderProps) {
  const tourStatus = useFeatureTour(props);

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
