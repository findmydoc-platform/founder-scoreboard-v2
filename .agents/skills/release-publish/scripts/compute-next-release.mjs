#!/usr/bin/env node

import {
  determineNextRelease,
  ensureGhAuth,
  fetchMainAndTags,
  formatReleasePlanSummary,
} from "./lib.mjs";

try {
  const jsonMode = process.argv.includes("--json");
  ensureGhAuth();
  fetchMainAndTags();
  const releasePlan = await determineNextRelease();

  if (jsonMode) {
    console.log(JSON.stringify(releasePlan, null, 2));
  } else {
    console.log(formatReleasePlanSummary(releasePlan));
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
