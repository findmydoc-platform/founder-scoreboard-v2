import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const { canonicalizeProfileMentionsForGitHub, githubMentionContext, mentionedProfileIds } = await loadTranspiledModule("src/lib/mentions.ts");

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

test("does not notify profiles mentioned inside Markdown code, links, autolinks, or URLs", () => {
  const comment = [
    "Normal @volkan",
    "`@sebastian`",
    "```text",
    "@sebastian",
    "```",
    "[@sebastian](https://example.test/@sebastian)",
    "[@sebastian][profile]",
    "<https://example.test/@sebastian>",
    "https://example.test/@sebastian",
  ].join("\n");

  assert.deepEqual(
    mentionedProfileIds(comment, profiles),
    ["volkan"],
  );
});

test("does not notify profiles mentioned inside Markdown block quotes", () => {
  assert.deepEqual(
    mentionedProfileIds("> Previous @sebastian\n\nCurrent @volkan", profiles),
    ["volkan"],
  );
});

test("resolves GitHub mentions only through unique GitHub logins and includes self-mentions", () => {
  const githubProfiles = [
    ...profiles,
    { id: "duplicate", name: "Duplicate", githubLogin: "MehmetVolkan" },
    { id: "name-only", name: "Outside", githubLogin: "" },
  ];
  assert.deepEqual(
    githubMentionContext(
      "@SebastianSchuetze @MehmetVolkan @Outside @SebastianSchuetze",
      githubProfiles,
      "SebastianSchuetze",
    ),
    { actorProfileId: "sebastian", recipientProfileIds: ["sebastian"] },
  );
});

test("keeps a local self-mention as a notification recipient", () => {
  assert.deepEqual(
    mentionedProfileIds("Reminder für @sebastian", profiles),
    ["sebastian"],
  );
});

test("recognizes GitHub username punctuation without accepting invalid login shapes", () => {
  const githubProfiles = [
    ...profiles,
    { id: "one", name: "One", githubLogin: "x" },
    { id: "hyphenated", name: "Hyphenated", githubLogin: "foo-bar" },
    { id: "partial", name: "Partial", githubLogin: "foo" },
  ];

  assert.deepEqual(
    githubMentionContext("Ping @MehmetVolkan. @x, and @foo-bar!", githubProfiles, "outside"),
    { actorProfileId: "", recipientProfileIds: ["volkan", "one", "hyphenated"] },
  );
  assert.deepEqual(
    githubMentionContext("Ignore @foo_bar @foo.bar @-foo @foo-", githubProfiles, "outside"),
    { actorProfileId: "", recipientProfileIds: [] },
  );
});

test("keeps app notification matching aligned with canonical GitHub logins", () => {
  assert.deepEqual(
    mentionedProfileIds("Ping @SebastianSchuetze", profiles),
    ["sebastian"],
  );
});

test("preserves hyphens when matching exact GitHub logins", () => {
  const distinctProfiles = [
    { id: "hyphenated", name: "Hyphenated", githubLogin: "foo-bar" },
    { id: "plain", name: "Plain", githubLogin: "foobar" },
  ];

  assert.deepEqual(
    mentionedProfileIds("Ping @foo-bar and @foobar", distinctProfiles),
    ["hyphenated", "plain"],
  );
});

test("prefers an exact GitHub login over another profile's id or name", () => {
  const collidingProfiles = [
    ...profiles,
    { id: "sebastianschuetze", name: "Other Person", githubLogin: "other-person" },
  ];

  assert.deepEqual(
    mentionedProfileIds("Ping @SebastianSchuetze", collidingProfiles),
    ["sebastian"],
  );
});
