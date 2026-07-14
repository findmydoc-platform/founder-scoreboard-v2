import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { canonicalizeProfileMentionsForGitHub, mentionedProfileIds } = await loadTranspiledModule("src/lib/mentions.ts");

const profiles = [
  { id: "sebastian", name: "Sebastian Schütze", githubLogin: "SebastianSchuetze" },
  { id: "volkan", name: "Mehmet Volkan Kablan", githubLogin: "MehmetVolkan" },
];

test("canonicalizes selected profile names to their GitHub login", () => {
  assert.equal(
    canonicalizeProfileMentionsForGitHub("Danke @sebastian und @Volkan.", profiles),
    "Danke @SebastianSchuetze und @MehmetVolkan.",
  );
});

test("preserves unknown, ambiguous, and email-like mentions", () => {
  const ambiguousProfiles = [
    ...profiles,
    { id: "sebastian-probst", name: "Sebastian Probst", githubLogin: "sebastian-probst" },
  ];

  assert.equal(
    canonicalizeProfileMentionsForGitHub("@Sebastian user@example.com @outside", ambiguousProfiles),
    "@Sebastian user@example.com @outside",
  );
});

test("does not turn profiles without a GitHub login into external mentions", () => {
  assert.equal(
    canonicalizeProfileMentionsForGitHub(
      "Bitte @Youssef prüfen.",
      [...profiles, { id: "youssef", name: "Youssef Amrani", githubLogin: "" }],
    ),
    "Bitte Youssef Amrani prüfen.",
  );
});

test("preserves mentions inside Markdown code, links, autolinks, and URLs", () => {
  const comment = [
    "Normal @sebastian",
    "`@sebastian`",
    "```text",
    "@sebastian",
    "```",
    "[@sebastian](https://example.test/@sebastian)",
    "[@sebastian][profile]",
    "[@sebastian]",
    "<https://example.test/@sebastian>",
    "https://example.test/@sebastian",
    "HTTPS://example.test/@sebastian",
    "",
    "[profile]: https://example.test/profile",
  ].join("\n");

  assert.equal(
    canonicalizeProfileMentionsForGitHub(comment, profiles),
    comment.replace("Normal @sebastian", "Normal @SebastianSchuetze"),
  );
});

test("keeps app notification matching aligned with canonical GitHub logins", () => {
  assert.deepEqual(
    mentionedProfileIds("Ping @SebastianSchuetze", profiles, "volkan"),
    ["sebastian"],
  );
});

test("prefers an exact GitHub login over another profile's id or name", () => {
  const collidingProfiles = [
    ...profiles,
    { id: "sebastianschuetze", name: "Other Person", githubLogin: "other-person" },
  ];

  assert.deepEqual(
    mentionedProfileIds("Ping @SebastianSchuetze", collidingProfiles, "volkan"),
    ["sebastian"],
  );
});
