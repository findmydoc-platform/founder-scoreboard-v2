import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const {
  activeMarkdownMention,
  canonicalizeProfileMentionsForGitHub,
  githubMentionContext,
  mentionSuggestions,
  mentionedProfileIds,
  replaceActiveMention,
} = await importTestModule("src/lib/mentions.ts");

const profiles = [
  { id: "sebastian", name: "Sebastian Schütze", githubLogin: "SebastianSchuetze" },
  { id: "volkan", name: "Mehmet Volkan Kablan", githubLogin: "MehmetVolkan" },
];

test("canonicalizes only exact GitHub logins", () => {
  assert.equal(
    canonicalizeProfileMentionsForGitHub("Danke @sebastianschuetze und @Volkan.", profiles),
    "Danke @SebastianSchuetze und @Volkan.",
  );
});

test("offers GitHub-linked profiles for the active mention at the caret", () => {
  const active = activeMarkdownMention("Bitte @vol prüfen", 10, 10);
  assert.deepEqual(active, { query: "vol", start: 6, end: 10 });
  assert.deepEqual(
    mentionSuggestions(active?.query || "", [
      ...profiles,
      { id: "no-login", name: "No Login", githubLogin: "" },
      { id: "other", name: "Volker Beispiel", githubLogin: "volker" },
    ]).map((profile) => profile.githubLogin),
    ["MehmetVolkan", "volker"],
  );
});

test("replaces the complete mention token and keeps text around it", () => {
  const active = activeMarkdownMention("Bitte @vol prüfen", 10, 10);
  assert.deepEqual(
    replaceActiveMention("Bitte @vol prüfen", active, profiles[1]),
    { value: "Bitte @MehmetVolkan prüfen", caret: 19 },
  );
});

test("does not open mention completion inside Markdown-protected text or email addresses", () => {
  assert.equal(activeMarkdownMention("`@vol`", 5, 5), null);
  assert.equal(activeMarkdownMention("user@vol", 8, 8), null);
  assert.equal(activeMarkdownMention("> @vol", 6, 6), null);
  assert.equal(activeMarkdownMention("[@vol](https://example.test)", 5, 5), null);
  assert.equal(activeMarkdownMention("https://example.test/@vol", 25, 25), null);
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

test("keeps profile names without GitHub logins as plain text", () => {
  assert.equal(
    canonicalizeProfileMentionsForGitHub(
      "Bitte @Youssef prüfen.",
      [...profiles, { id: "youssef", name: "Youssef Amrani", githubLogin: "" }],
    ),
    "Bitte @Youssef prüfen.",
  );
});

test("preserves mentions inside Markdown code, links, autolinks, and URLs", () => {
  const comment = [
    "Normal @sebastianschuetze",
    "`@sebastianschuetze`",
    "```text",
    "@sebastianschuetze",
    "```",
    "[@sebastianschuetze](https://example.test/@sebastianschuetze)",
    "[@sebastianschuetze][profile]",
    "[@sebastianschuetze]",
    "<https://example.test/@sebastianschuetze>",
    "https://example.test/@sebastianschuetze",
    "HTTPS://example.test/@sebastianschuetze",
    "",
    "[profile]: https://example.test/profile",
  ].join("\n");

  assert.equal(
    canonicalizeProfileMentionsForGitHub(comment, profiles),
    comment.replace("Normal @sebastianschuetze", "Normal @SebastianSchuetze"),
  );
});

test("does not notify profiles mentioned inside Markdown code, links, autolinks, or URLs", () => {
  const comment = [
    "Normal @MehmetVolkan",
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
    mentionedProfileIds("> Previous @sebastian\n\nCurrent @MehmetVolkan", profiles),
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
    mentionedProfileIds("Reminder für @SebastianSchuetze", profiles),
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

test("notifies a profile with a one-character GitHub login", () => {
  assert.deepEqual(
    mentionedProfileIds("Ping @x", [{ id: "one", name: "One", githubLogin: "x" }]),
    ["one"],
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
