import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { verifyCredentialBoundary } from "./lib/credential-boundary.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const policy = JSON.parse(readFileSync(new URL("./lib/credential-boundary-policy.json", import.meta.url), "utf8"));
const failures = verifyCredentialBoundary({ root, ...policy });
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else console.log("Credential dependency boundary verified.");
