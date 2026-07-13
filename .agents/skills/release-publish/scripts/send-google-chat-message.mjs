#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  GOOGLE_CHAT_SECRET_NAME,
  GOOGLE_CHAT_WORKFLOW_FILE,
  buildGoogleChatPayload,
  buildWorkflowDispatchPayload,
  dispatchWorkflow,
  ensureGhAuth,
  fetchMainAndTags,
  getHeadSha,
  getReleaseByTag,
  getRepoSlug,
  readArgValue,
  repositorySecretExists,
  waitForWorkflowRun,
} from "./lib.mjs";

try {
  const releaseTag = readArgValue(process.argv, "--release-tag");
  const messageTextArg = readArgValue(process.argv, "--message-text");
  const messageFile = readArgValue(process.argv, "--message-file");
  const webhookUrlArg = readArgValue(process.argv, "--webhook-url");
  const dryRun = process.argv.includes("--dry-run");
  const forceSend = process.argv.includes("--yes");

  if (!releaseTag) throw new Error("Missing required argument: --release-tag");
  if (messageTextArg && messageFile) throw new Error("Use either --message-text or --message-file, not both.");
  if (webhookUrlArg) {
    throw new Error(
      `Local webhook URLs are not supported. Store the webhook in the ${GOOGLE_CHAT_SECRET_NAME} repository secret and use the workflow-backed send path.`,
    );
  }

  const repoSlug = getRepoSlug();
  const release = getReleaseByTag(repoSlug, releaseTag);
  if (!release.body?.trim()) throw new Error(`Release ${releaseTag} does not contain release notes.`);

  const messageText = messageFile ? readFileSync(messageFile, "utf8") : messageTextArg;
  if (!messageText) throw new Error("Missing message text. Pass --message-text or --message-file.");

  const payload = buildGoogleChatPayload(messageText, releaseTag);
  const workflowDispatchPayload = buildWorkflowDispatchPayload({
    ref: "main",
    inputs: {
      message_payload_json: JSON.stringify(payload),
      release_tag: releaseTag,
    },
  });

  if (dryRun) {
    console.log(JSON.stringify({
      workflow: {
        file: GOOGLE_CHAT_WORKFLOW_FILE,
        ref: "main",
        repositorySecret: GOOGLE_CHAT_SECRET_NAME,
      },
      payload,
      workflowDispatchPayload,
    }, null, 2));
    process.exit(0);
  }

  ensureGhAuth();
  if (!repositorySecretExists({ repoSlug, secretName: GOOGLE_CHAT_SECRET_NAME })) {
    throw new Error(`${GOOGLE_CHAT_SECRET_NAME} repository secret is missing on ${repoSlug}.`);
  }

  console.log("Google Chat message preview:");
  console.log(payload.text);

  let shouldSend = forceSend;
  if (!shouldSend && process.stdin.isTTY && process.stdout.isTTY) {
    const readline = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await readline.question("Send this Google Chat message now? [y/N] ");
    readline.close();
    shouldSend = /^y(es)?$/i.test(answer.trim());
  }

  if (!shouldSend) {
    console.log("Google Chat message was not sent. Re-run with --yes after approval.");
    process.exit(0);
  }

  fetchMainAndTags();
  const mainHead = getHeadSha("origin/main");
  const dispatch = dispatchWorkflow({
    repoSlug,
    workflowFile: GOOGLE_CHAT_WORKFLOW_FILE,
    ref: "main",
    inputs: workflowDispatchPayload.inputs,
  });
  console.log("Google Chat release workflow dispatched.");

  const workflowRun = await waitForWorkflowRun({
    repoSlug,
    workflowFile: GOOGLE_CHAT_WORKFLOW_FILE,
    ref: "main",
    headSha: mainHead,
    dispatchedAt: dispatch.dispatchedAt,
  });
  console.log(`Google Chat message sent for ${releaseTag}: ${workflowRun.html_url}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
