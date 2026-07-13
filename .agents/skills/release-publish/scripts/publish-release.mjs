#!/usr/bin/env node

import {
  GOOGLE_CHAT_SECRET_NAME,
  GOOGLE_CHAT_WORKFLOW_FILE,
  buildChatMessage,
  buildGoogleChatPayload,
  buildReleaseNotes,
  buildWorkflowDispatchPayload,
  createRelease,
  determineNextRelease,
  ensureGhAuth,
  fetchMainAndTags,
  formatReleasePlanSummary,
  getRepoSlug,
  releaseExists,
  renderUsedPullRequests,
  repositorySecretExists,
  tagExists,
} from "./lib.mjs";

const SITE_URL = process.env.GOOGLE_CHAT_SITE_URL ?? "https://founder-ops.findmydoc.eu";

function ensureExactFlagSelection() {
  const dryRun = process.argv.includes("--dry-run");
  const dryRunJson = process.argv.includes("--dry-run-json");
  const execute = process.argv.includes("--execute");
  if (Number(dryRun) + Number(dryRunJson) + Number(execute) !== 1) {
    throw new Error("Use exactly one of --dry-run, --dry-run-json, or --execute.");
  }
  return { dryRun, dryRunJson, execute };
}

function buildPlanOutput({ repoSlug, releasePlan, releaseUrl, googleChatSecretConfigured }) {
  const notes = buildReleaseNotes({ releaseTag: releasePlan.nextTag, releasePlan, releaseUrl });
  const chatMessage = buildChatMessage({
    releaseTag: releasePlan.nextTag,
    releasePlan,
    releaseUrl,
    siteUrl: SITE_URL,
  });
  const chatPayload = buildGoogleChatPayload(chatMessage, releasePlan.nextTag);
  return {
    releasePlan,
    release: {
      endpoint: `repos/${repoSlug}/releases`,
      expectedUrl: releaseUrl,
      payload: {
        tag_name: releasePlan.nextTag,
        target_commitish: releasePlan.targetCommit,
        name: `FounderOps ${releasePlan.nextTag}`,
      },
      notes,
    },
    chat: {
      repositorySecretConfigured: googleChatSecretConfigured,
      repositorySecretName: GOOGLE_CHAT_SECRET_NAME,
      workflowFile: GOOGLE_CHAT_WORKFLOW_FILE,
      endpoint: `repos/${repoSlug}/actions/workflows/${GOOGLE_CHAT_WORKFLOW_FILE}/dispatches`,
      payloadTemplate: buildWorkflowDispatchPayload({
        ref: "main",
        inputs: {
          message_payload_json: JSON.stringify(chatPayload),
          release_tag: releasePlan.nextTag,
        },
      }),
      message: chatMessage,
    },
  };
}

function printDryRun(output) {
  console.log(formatReleasePlanSummary(output.releasePlan));
  console.log("");
  console.log(renderUsedPullRequests(output.releasePlan));
  console.log("");
  console.log("Release notes draft:");
  console.log(output.release.notes);
  console.log("Planned GitHub release action:");
  console.log(`- Endpoint: ${output.release.endpoint}`);
  console.log(`- Expected release URL: ${output.release.expectedUrl}`);
  console.log(`- Payload: ${JSON.stringify(output.release.payload, null, 2)}`);
  console.log("");
  console.log("Planned Google Chat send:");
  console.log(`- Repository secret ${output.chat.repositorySecretName} configured: ${output.chat.repositorySecretConfigured ? "yes" : "no"}`);
  console.log(`- Send workflow: ${output.chat.workflowFile}`);
  console.log(`- Endpoint: ${output.chat.endpoint}`);
  console.log(`- Payload template: ${JSON.stringify(output.chat.payloadTemplate, null, 2)}`);
  console.log("");
  console.log("Chat message:");
  console.log(output.chat.message);
  console.log("");
  console.log("Dry run only: no GitHub release or Google Chat message sent.");
}

async function main() {
  const { dryRun, dryRunJson } = ensureExactFlagSelection();
  ensureGhAuth();
  fetchMainAndTags();

  const repoSlug = getRepoSlug();
  const releasePlan = await determineNextRelease({ repoSlug });
  if (tagExists(releasePlan.nextTag)) throw new Error(`Tag ${releasePlan.nextTag} already exists.`);
  if (releaseExists(repoSlug, releasePlan.nextTag)) throw new Error(`Release ${releasePlan.nextTag} already exists on GitHub.`);

  const releaseUrl = `https://github.com/${repoSlug}/releases/tag/${releasePlan.nextTag}`;
  const googleChatSecretConfigured = repositorySecretExists({ repoSlug, secretName: GOOGLE_CHAT_SECRET_NAME });
  const output = buildPlanOutput({
    repoSlug,
    releasePlan,
    releaseUrl,
    googleChatSecretConfigured,
  });

  if (dryRun || dryRunJson) {
    if (dryRunJson) console.log(JSON.stringify(output, null, 2));
    else printDryRun(output);
    return;
  }

  const release = createRelease({
    repoSlug,
    tag: releasePlan.nextTag,
    targetCommitish: releasePlan.targetCommit,
    notes: output.release.notes,
  });
  const createdReleaseUrl = release.url ?? releaseUrl;
  console.log(`Release created: ${createdReleaseUrl}`);
  console.log(renderUsedPullRequests(releasePlan));

  if (!googleChatSecretConfigured) {
    console.log(
      `${GOOGLE_CHAT_SECRET_NAME} repository secret is not configured. Release is complete; set it before sending the Google Chat announcement with: gh secret set ${GOOGLE_CHAT_SECRET_NAME} --repo ${repoSlug}`,
    );
    return;
  }

  console.log(
    `Draft or adjust the final German Google Chat message, then send it with: node .agents/skills/release-publish/scripts/send-google-chat-message.mjs --release-tag ${releasePlan.nextTag} --message-file <path> --yes`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
