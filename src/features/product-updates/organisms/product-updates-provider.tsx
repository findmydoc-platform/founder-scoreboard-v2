"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, MousePointerClick, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import { productUpdates, type ProductUpdateDefinition } from "@/features/product-updates/model/product-update-registry";
import {
  flattenProductUpdateSlides,
  selectActiveProductUpdates,
  selectUnseenProductUpdates,
} from "@/features/product-updates/model/product-update-selection";

const storagePrefix = "founderops.product-updates.seen";

function storageKey(profileId: string | null) {
  return `${storagePrefix}.${profileId || "local"}`;
}

function readSeenUpdateIds(profileId: string | null) {
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey(profileId)) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeSeenUpdateIds(profileId: string | null, updateIds: readonly string[]) {
  try {
    window.localStorage.setItem(storageKey(profileId), JSON.stringify(Array.from(new Set(updateIds))));
  } catch {
    // The gallery still works when browser storage is unavailable.
  }
}

function formatReleaseDate(value: string) {
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" })
    .format(new Date(`${value}T12:00:00Z`));
}

export function ProductUpdatesProvider({ profileId }: { profileId: string | null }) {
  const [visibleUpdates, setVisibleUpdates] = useState<ProductUpdateDefinition[]>([]);
  const [slideIndex, setSlideIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const slides = useMemo(() => flattenProductUpdateSlides(visibleUpdates), [visibleUpdates]);
  const activeSlide = slides[slideIndex];

  const close = useCallback(() => {
    const seen = readSeenUpdateIds(profileId);
    writeSeenUpdateIds(profileId, [
      ...seen,
      ...visibleUpdates.map((update) => update.id),
    ]);
    setOpen(false);
  }, [profileId, visibleUpdates]);
  const dialogRef = useModalDialog<HTMLDivElement>({ open, onClose: close });

  const showUpdates = useCallback((updates: ProductUpdateDefinition[]) => {
    if (!updates.length) return;
    setVisibleUpdates(updates);
    setSlideIndex(0);
    setOpen(true);
  }, []);

  useEffect(() => {
    const unseen = selectUnseenProductUpdates(productUpdates, readSeenUpdateIds(profileId));
    if (!unseen.length) return;
    const frame = window.requestAnimationFrame(() => showUpdates(unseen));
    return () => window.cancelAnimationFrame(frame);
  }, [profileId, showUpdates]);

  useEffect(() => {
    const openProductUpdates = () => showUpdates(selectActiveProductUpdates(productUpdates));
    window.addEventListener("fmd:open-product-updates", openProductUpdates);
    return () => window.removeEventListener("fmd:open-product-updates", openProductUpdates);
  }, [showUpdates]);

  if (!open || !activeSlide) return null;

  const isFirst = slideIndex === 0;
  const isLast = slideIndex === slides.length - 1;

  const startFeatureTour = () => {
    const tourId = activeSlide.featureTourId;
    close();
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent("fmd:start-feature-tour", { detail: { tourId } }));
    }, 0);
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex justify-end bg-slate-950/40 sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-updates-title"
        className="flex h-full w-full flex-col overflow-hidden bg-white shadow-2xl sm:max-w-[720px] sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-7">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Was ist neu</div>
            <h2 id="product-updates-title" className="mt-1 truncate text-xl font-semibold text-slate-950">
              {activeSlide.updateTitle}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{formatReleaseDate(activeSlide.releasedAt)}</p>
          </div>
          <button
            type="button"
            onClick={close}
            data-autofocus
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-600 transition hover:bg-slate-50"
            aria-label="Was ist neu schließen"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="border-b border-slate-200 bg-slate-100 p-3 sm:p-5">
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <Image
                src={activeSlide.image.src}
                alt={activeSlide.image.alt}
                width={activeSlide.image.width}
                height={activeSlide.image.height}
                className="aspect-[16/9] w-full object-cover object-top"
                priority={slideIndex === 0}
              />
            </div>
          </div>

          <div className="px-5 py-6 sm:px-7 sm:py-7">
            <div className="flex items-center justify-between gap-4 text-xs font-semibold text-slate-500">
              <span>{slideIndex + 1} von {slides.length}</span>
              <div className="flex gap-1.5" aria-hidden="true">
                {slides.map((slide, index) => (
                  <span
                    key={`${slide.updateId}-${slide.id}`}
                    className={`h-1.5 rounded-full transition-all ${index === slideIndex ? "w-6 bg-blue-600" : "w-1.5 bg-slate-300"}`}
                  />
                ))}
              </div>
            </div>
            <h3 className="mt-4 text-2xl font-semibold tracking-tight text-slate-950">{activeSlide.title}</h3>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">{activeSlide.description}</p>
            {activeSlide.updateSummary && (
              <p className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-900">
                {activeSlide.updateSummary}
              </p>
            )}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 sm:px-7">
          <button
            type="button"
            onClick={startFeatureTour}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <MousePointerClick size={16} aria-hidden="true" />
            Lass dich leiten
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSlideIndex((index) => Math.max(0, index - 1))}
              disabled={isFirst}
              className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-35"
              aria-label="Vorherige Neuerung"
            >
              <ChevronLeft size={18} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => isLast ? close() : setSlideIndex((index) => Math.min(slides.length - 1, index + 1))}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              {isLast ? "Fertig" : "Weiter"}
              {!isLast && <ChevronRight size={17} aria-hidden="true" />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
