import { fileURLToPath } from "node:url";
import { verifyClientCredentialBundle } from "./lib/client-credential-bundle.mjs";
const result = verifyClientCredentialBundle(fileURLToPath(new URL("../", import.meta.url)));
if (result.failures.length) { console.error(result.failures.join("\n")); process.exitCode = 1; }
else console.log(`Credential-free production client verified: ${result.files} chunks/maps, ${result.bytes} bytes.`);
