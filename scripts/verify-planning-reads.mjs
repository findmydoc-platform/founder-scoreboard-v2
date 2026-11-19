import { readFileSync } from "node:fs";
import { verifyPlanningReadBoundary } from "./lib/planning-read-boundary.mjs";

const policy = JSON.parse(readFileSync(new URL("./lib/planning-read-boundary-policy.json", import.meta.url), "utf8"));
const failures = verifyPlanningReadBoundary({ root: process.cwd(), policy });
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else console.log("Planning read dependency and ownership contracts passed.");
