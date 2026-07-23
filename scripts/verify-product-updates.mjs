import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseGitNumstat, requiresProductUpdateForDiff } from "./lib/product-update-diff.mjs";

const registryPath = "src/features/product-updates/model/product-updates.json";
const tourRegistryPath = "src/features/product-tours/model/feature-tour-registry.ts";
const failures = [];
const baseRef = String(process.env.PRODUCT_UPDATE_BASE_REF || "").trim();

const updates = JSON.parse(await readFile(registryPath, "utf8"));
const tourRegistry = await readFile(tourRegistryPath, "utf8");

if (baseRef && !/^0+$/.test(baseRef)) {
  const diff = spawnSync("git", ["diff", "--numstat", baseRef, "HEAD"], { encoding: "utf8" });
  if (diff.status !== 0) {
    failures.push(`Could not compare product updates with deployment base ${baseRef}.`);
  } else {
    const diffEntries = parseGitNumstat(diff.stdout);
    const changedFiles = diffEntries.map((entry) => entry.path);
    const requiresProductUpdate = requiresProductUpdateForDiff(diffEntries);
    const hasProductUpdate = changedFiles.includes(registryPath)
      && changedFiles.some((file) => file.startsWith("public/product-updates/"));
    if (requiresProductUpdate && !hasProductUpdate) {
      failures.push("New or expanded production UI changes require both a product update registry change and a current screenshot under public/product-updates/.");
    }
  }
}

if (!Array.isArray(updates) || !updates.length) failures.push(`${registryPath} must contain at least one update.`);

const updateIds = new Set();
const featureTourIds = new Set();
for (const [updateIndex, update] of updates.entries()) {
  const label = `updates[${updateIndex}]`;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/.test(update.id || "")) failures.push(`${label}.id must use YYYY-MM-DD-short-name.`);
  if (updateIds.has(update.id)) failures.push(`${label}.id is duplicated: ${update.id}`);
  updateIds.add(update.id);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(update.releasedAt || "")) failures.push(`${label}.releasedAt must use YYYY-MM-DD.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(update.expiresAt || "")) {
    failures.push(`${label}.expiresAt must use YYYY-MM-DD.`);
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(update.releasedAt || "")) {
    const releaseTime = Date.parse(`${update.releasedAt}T00:00:00Z`);
    const expiryTime = Date.parse(`${update.expiresAt}T00:00:00Z`);
    const lifetimeDays = (expiryTime - releaseTime) / 86_400_000;
    if (!Number.isFinite(lifetimeDays) || lifetimeDays <= 0 || lifetimeDays > 60) {
      failures.push(`${label}.expiresAt must be 1 to 60 days after releasedAt.`);
    }
  }
  if (typeof update.featureTourId !== "string" || !/^[a-z0-9][a-z0-9._-]{1,80}$/.test(update.featureTourId)) {
    failures.push(`${label}.featureTourId is required and must be a valid Driver.js tour ID.`);
  } else {
    if (featureTourIds.has(update.featureTourId)) failures.push(`${label}.featureTourId must belong to only one product update: ${update.featureTourId}`);
    featureTourIds.add(update.featureTourId);
    if (!tourRegistry.includes(`"${update.featureTourId}"`)) failures.push(`${label}.featureTourId has no matching Driver.js tour: ${update.featureTourId}`);
    if (!tourRegistry.includes(`productUpdateId: "${update.id}"`)) failures.push(`${label} has no dedicated Driver.js tour linked through productUpdateId.`);
  }
  if (typeof update.title !== "string" || !update.title.trim()) failures.push(`${label}.title is required.`);
  if (typeof update.summary !== "string" || !update.summary.trim()) failures.push(`${label}.summary is required.`);
  if (!Array.isArray(update.slides) || !update.slides.length) {
    failures.push(`${label}.slides must contain at least one slide.`);
    continue;
  }

  const slideIds = new Set();
  for (const [slideIndex, slide] of update.slides.entries()) {
    const slideLabel = `${label}.slides[${slideIndex}]`;
    if (typeof slide.id !== "string" || !slide.id.trim()) failures.push(`${slideLabel}.id is required.`);
    if (slideIds.has(slide.id)) failures.push(`${slideLabel}.id is duplicated: ${slide.id}`);
    slideIds.add(slide.id);
    if (typeof slide.title !== "string" || !slide.title.trim()) failures.push(`${slideLabel}.title is required.`);
    if (typeof slide.description !== "string" || !slide.description.trim()) failures.push(`${slideLabel}.description is required.`);
    if (typeof slide.description === "string" && slide.description.length > 280) failures.push(`${slideLabel}.description must stay below 280 characters.`);
    if (!slide.image || typeof slide.image.src !== "string" || !slide.image.src.startsWith("/product-updates/")) {
      failures.push(`${slideLabel}.image.src must start with /product-updates/.`);
    } else {
      if (!slide.image.src.startsWith(`/product-updates/${update.id}/`)) failures.push(`${slideLabel}.image.src must use the update ID directory.`);
      const imagePath = path.join("public", slide.image.src.slice(1));
      if (!existsSync(imagePath)) failures.push(`${slideLabel}.image is missing: ${imagePath}`);
    }
    if (typeof slide.image?.alt !== "string" || !slide.image.alt.trim()) failures.push(`${slideLabel}.image.alt is required.`);
    if (!Number.isInteger(slide.image?.width) || slide.image.width <= 0) failures.push(`${slideLabel}.image.width must be a positive integer.`);
    if (!Number.isInteger(slide.image?.height) || slide.image.height <= 0) failures.push(`${slideLabel}.image.height must be a positive integer.`);
    if (slide.featureTourId !== undefined) failures.push(`${slideLabel}.featureTourId belongs on the update, not an individual slide.`);
  }
}

if (failures.length) {
  console.error(`Product update verification failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(JSON.stringify({ status: "product-updates-valid", updates: updates.length }, null, 2));
