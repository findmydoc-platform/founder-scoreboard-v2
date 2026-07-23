import type { ProductUpdateDefinition, ProductUpdateSlide } from "@/features/product-updates/model/product-update-registry";

export type ProductUpdateGallerySlide = ProductUpdateSlide & {
  expiresAt: string;
  featureTourId: string;
  releasedAt: string;
  updateId: string;
  updateSummary: string;
  updateTitle: string;
};

export function selectUnseenProductUpdates(
  updates: readonly ProductUpdateDefinition[],
  seenUpdateIds: readonly string[],
  now = new Date(),
) {
  const seen = new Set(seenUpdateIds);
  return selectActiveProductUpdates(updates, now).filter((update) => !seen.has(update.id));
}

export function productUpdateIsActive(
  update: ProductUpdateDefinition,
  now = new Date(),
) {
  const expiresAt = new Date(`${update.expiresAt}T23:59:59.999Z`);
  return Number.isFinite(expiresAt.getTime()) && expiresAt >= now;
}

export function selectActiveProductUpdates(
  updates: readonly ProductUpdateDefinition[],
  now = new Date(),
) {
  return updates.filter((update) => productUpdateIsActive(update, now));
}

export function flattenProductUpdateSlides(
  updates: readonly ProductUpdateDefinition[],
): ProductUpdateGallerySlide[] {
  return updates.flatMap((update) => update.slides.map((slide) => ({
    ...slide,
    expiresAt: update.expiresAt,
    featureTourId: update.featureTourId,
    releasedAt: update.releasedAt,
    updateId: update.id,
    updateSummary: update.summary,
    updateTitle: update.title,
  })));
}
