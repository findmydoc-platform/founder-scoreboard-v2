#!/usr/bin/env node

import { createCredentialStore } from "./credential-store.mjs";

const action = process.argv[2] || "status";

function usage() {
  console.error("Usage: configure-token.mjs {set|set-clipboard|status|delete}");
}

function platformLabel(platform) {
  return platform === "darwin" ? "macOS Keychain" : "Windows Credential Manager";
}

try {
  if (!["set", "set-clipboard", "status", "delete"].includes(action)) {
    usage();
    process.exitCode = 2;
  } else {
    const store = createCredentialStore();
    const label = platformLabel(store.platform);

    if (action === "set") {
      store.setInteractive();
      console.log(`FounderOps Team Task Intake token stored in ${label}.`);
    }
    if (action === "set-clipboard") {
      store.setClipboard();
      console.log(`FounderOps Team Task Intake token imported from clipboard into ${label}.`);
    }
    if (action === "status") {
      if (!store.status()) throw new Error(`FounderOps Team Task Intake token is not configured in ${label}.`);
      console.log(`FounderOps Team Task Intake token is configured in ${label}.`);
    }
    if (action === "delete") {
      store.deleteToken();
      console.log(`FounderOps Team Task Intake token removed from ${label}.`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

