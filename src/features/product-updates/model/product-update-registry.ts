import productUpdateData from "@/features/product-updates/model/product-updates.json";

export type ProductUpdateImage = {
  alt: string;
  height: number;
  src: string;
  width: number;
};

export type ProductUpdateSlide = {
  description: string;
  id: string;
  image: ProductUpdateImage;
  title: string;
};

export type ProductUpdateDefinition = {
  expiresAt: string;
  featureTourId: string;
  id: string;
  releasedAt: string;
  slides: ProductUpdateSlide[];
  summary: string;
  title: string;
};

export const productUpdates = productUpdateData as ProductUpdateDefinition[];
