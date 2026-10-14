import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const {
  activeMarkdownMention,
  availableMentionOptions,
  canonicalizeProfileMentionsForGitHub,
  githubMentionContext,
  isGitHubLogin,
  mentionOptions,
  mentionSuggestions,
  mentionedProfileIds,
  newlyMentionedProfileIds,
  newlyMentionedProfilesByField,
  normalizeGitHubMentionsForFounderOps,
  replaceActiveMention,
} = await importTestModule("src/lib/mentions.ts");

const profiles = [
  { id: "sebastian", name: "Sebastian Schütze", githubLogin: "SebastianSchuetze" },
  { id: "volkan", name: "Mehmet Volkan Kablan", githubLogin: "MehmetVolkan" },
];

test("offers @all before people and includes every FounderOps profile", () => {
  const allProfiles = [...profiles, { id: "no-login", name: "No Login", githubLogin: "" }];
  assert.deepEqual(
    mentionOptions("", allProfiles).map((option) => option.kind === "all" ? option.login : option.profile.githubLogin),
    ["all", "MehmetVolkan", "SebastianSchuetze"],
  );
  assert.deepEqual(mentionedProfileIds("Ping @all", allProfiles), ["sebastian", "volkan", "no-login"]);
  assert.deepEqual(mentionOptions("", []).map((option) => option.login), ["all"]);
  assert.equal(mentionOptions("", allProfiles)[0].count, 3);
});

test("offers each mention only once per text field while allowing the active token to be edited", () => {
  const repeatedPerson = "@SebastianSchuetze und @seb";
  const repeatedPersonActive = activeMarkdownMention(repeatedPerson, repeatedPerson.length, repeatedPerson.length);
  assert.deepEqual(availableMentionOptions("seb", profiles, repeatedPerson, repeatedPersonActive), []);

  const repeatedAll = "@all und @al";
  const repeatedAllActive = activeMarkdownMention(repeatedAll, repeatedAll.length, repeatedAll.length);
  assert.deepEqual(availableMentionOptions("al", profiles, repeatedAll, repeatedAllActive), []);

  const editedMention = "@SebastianSchuetze";
  const editedMentionActive = activeMarkdownMention(editedMention, editedMention.length, editedMention.length);
  assert.deepEqual(
    availableMentionOptions("SebastianSchuetze", profiles, editedMention, editedMentionActive).map((option) => option.id),
    ["sebastian"],
  );
});

test("filters @all like a normal picker option and inserts its local token", () => {
  assert.deepEqual(mentionOptions("al", profiles).map((option) => option.kind), ["all"]);
  const active = activeMarkdownMention("Bitte @al prüfen", 9, 9);
  assert.deepEqual(
    replaceActiveMention("Bitte @al prüfen", active, mentionOptions("al", profiles)[0]),
    { value: "Bitte @all prüfen", caret: 10 },
  );
});

test("keeps @all inactive in Markdown-protected content", () => {
  assert.deepEqual(mentionedProfileIds("`@all`\n> @all\nhttps://example.test/@all", profiles), []);
});

test("projects @all to the configured GitHub team and falls back to linked logins", () => {
  assert.equal(
    canonicalizeProfileMentionsForGitHub("Ping @all", profiles, { organization: "findmydoc-platform", teamSlug: "founderops" }),
    "Ping @findmydoc-platform/founderops",
  );
  assert.equal(
    canonicalizeProfileMentionsForGitHub("Ping @all", profiles),
    "Ping @SebastianSchuetze @MehmetVolkan",
  );
});

test("maps the configured GitHub team mention and literal @all to local recipients", () => {
  const body = "Ping @findmydoc-platform/founderops and @all";
  assert.equal(
    normalizeGitHubMentionsForFounderOps(body, { organization: "findmydoc-platform", teamSlug: "founderops" }),
    "Ping @all and @all",
  );
  assert.deepEqual(
    githubMentionContext(body, profiles, "outside", { organization: "findmydoc-platform", teamSlug: "founderops" }),
    { actorProfileId: "", recipientProfileIds: ["sebastian", "volkan"] },
  );
});

test("returns only newly added recipients for edit notifications", () => {
  assert.deepEqual(newlyMentionedProfileIds(["one", "two"], ["two", "three"]), ["three"]);
  assert.deepEqual(newlyMentionedProfileIds(["one"], ["one"]), []);
  assert.deepEqual(newlyMentionedProfileIds([], ["one"]), ["one"]);
});

test("resolves new field mentions once per recipient and preserves the first exact target", () => {
  assert.deepEqual(newlyMentionedProfilesByField([
    { key: "problem", previous: "", current: "Ping @all" },
    { key: "outcome", previous: "", current: "Again @MehmetVolkan" },
  ], profiles), [
    { profileId: "sebastian", fieldKey: "problem", excerpt: "Ping @all" },
    { profileId: "volkan", fieldKey: "problem", excerpt: "Ping @all" },
  ]);
});

test("new planning items create canonical mention notifications for every free-text field", async () => {
  const { buildCreateMentionNotifications } = await importTestModule(
    "src/features/planning-items/model/planning-items-browser-task-create.ts",
    { "server-only": {} },
  );
  const notifications = buildCreateMentionNotifications({
    taskId: "task-1",
    taskTitle: "Mention task",
    actorProfileId: "sebastian",
    fields: [
      { key: "problem", current: "Ping @all" },
      { key: "outcome", current: "Again @MehmetVolkan" },
    ],
    profiles: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      github_login: profile.githubLogin,
    })),
  });

  assert.deepEqual(notifications.map((notification) => ({
    recipient: notification.recipient_profile_id,
    target: notification.target_path,
    dedupeKey: notification.dedupe_key,
  })), [
    {
      recipient: "sebastian",
      target: "/tasks/task-1?focus=field:problem",
      dedupeKey: "task.mention:field:task-1:problem:created:sebastian",
    },
    {
      recipient: "volkan",
      target: "/tasks/task-1?focus=field:problem",
      dedupeKey: "task.mention:field:task-1:problem:created:volkan",
    },
  ]);
});

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

test("filters accents and ranks exact logins before name and login prefixes", () => {
  assert.deepEqual(
    mentionSuggestions("SCHUTZE", [
      { id: "exact", name: "Other Person", githubLogin: "schutze" },
      { id: "name-prefix", name: "Schütze Team", githubLogin: "team-member" },
      { id: "login-prefix", name: "Other Person", githubLogin: "schutze-team" },
      { id: "name-contains", name: "Kleinschütze", githubLogin: "sebastian" },
    ]).map((profile) => profile.githubLogin),
    ["schutze", "team-member", "schutze-team", "sebastian"],
  );
});

test("replaces the complete mention token and keeps text around it", () => {
  const active = activeMarkdownMention("Bitte @vol prüfen", 10, 10);
  assert.deepEqual(
    replaceActiveMention("Bitte @vol prüfen", active, profiles[1]),
    { value: "Bitte @MehmetVolkan prüfen", caret: 19 },
  );
});

test("keeps valid GitHub-login suggestions aligned with inserted and delivered mentions", () => {
  const invalidLogins = ["bad_login", "-bad", "bad-", "a".repeat(40)];
  for (const githubLogin of invalidLogins) {
    const invalidProfile = { id: githubLogin, name: "Invalid", githubLogin };
    const active = activeMarkdownMention("@bad", 4, 4);
    assert.equal(isGitHubLogin(githubLogin), false);
    assert.deepEqual(mentionSuggestions("", [invalidProfile]), []);
    assert.equal(replaceActiveMention("@bad", active, invalidProfile), null);
    assert.deepEqual(mentionedProfileIds(`Ping @${githubLogin}`, [invalidProfile]), []);
    assert.equal(canonicalizeProfileMentionsForGitHub(`Ping @${githubLogin}`, [invalidProfile]), `Ping @${githubLogin}`);
  }
});

test("keeps accent and hyphen search active until a valid GitHub login is selected", () => {
  const accented = "@Schu\u0308";
  assert.deepEqual(
    activeMarkdownMention(accented, accented.length, accented.length),
    { query: "Schu\u0308", start: 0, end: accented.length },
  );
  assert.deepEqual(
    mentionSuggestions("foo-b", [{ id: "hyphenated", name: "Independent", githubLogin: "foo-bar" }]).map((profile) => profile.githubLogin),
    ["foo-bar"],
  );
});

test("does not open mention completion inside Markdown-protected text or email addresses", () => {
  assert.equal(activeMarkdownMention("`@vol`", 5, 5), null);
  assert.equal(activeMarkdownMention("user@vol", 8, 8), null);
  assert.equal(activeMarkdownMention("> @vol", 6, 6), null);
  assert.equal(activeMarkdownMention("[@vol](https://example.test)", 5, 5), null);
  assert.equal(activeMarkdownMention("https://example.test/@vol", 25, 25), null);
  assert.equal(activeMarkdownMention("    @vol", 8, 8), null);
  const lazyQuote = "> Previous context\nContinuation @vol";
  assert.equal(activeMarkdownMention(lazyQuote, lazyQuote.length, lazyQuote.length), null);
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

test("keeps indented code and lazy block quotes out of delivery", () => {
  const comment = [
    "    @SebastianSchuetze",
    "> Previous context",
    "Continuation @MehmetVolkan",
  ].join("\n");
  assert.deepEqual(mentionedProfileIds(comment, profiles), []);
  assert.deepEqual(githubMentionContext(comment, profiles, "outside"), { actorProfileId: "", recipientProfileIds: [] });
  assert.equal(canonicalizeProfileMentionsForGitHub(comment, profiles), comment);
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
