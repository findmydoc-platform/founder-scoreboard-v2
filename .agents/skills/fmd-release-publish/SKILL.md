---
name: fmd-release-publish
description: Use when publishing FounderOps GitHub releases, computing the next FounderOps release tag, drafting management-focused release notes from merged pull requests, or sending release announcements to Google Chat through GitHub Actions.
---

# FMD Release Publish

## Goal

Publish FounderOps releases from `origin/main`, summarize merged pull requests in management language, and send a deliberate Google Chat release announcement through the repository workflow.

## Workflow

1. Fetch `origin/main` and tags; treat `origin/main` as the release source of truth.
2. Run `node .agents/skills/fmd-release-publish/scripts/publish-release.mjs --dry-run` first.
3. Review the PR control list, release notes draft, and proposed German Google Chat message.
4. Publish with `node .agents/skills/fmd-release-publish/scripts/publish-release.mjs --execute`.
5. Send the approved message with `node .agents/skills/fmd-release-publish/scripts/send-google-chat-message.mjs --release-tag <tag> --message-file <path> --yes`.

## Release Rules

- If no semantic `v*.*.*` tag exists, the first release is `v0.1.0` and starts at PR #17.
- After the first release, SemVer is computed from commits since the latest merged semantic tag on `origin/main`.
- `feat` bumps minor; breaking changes bump major; other conventional or non-conventional commits fall back to patch.
- Bot, Dependabot, dependency, and maintenance-only PRs are excluded from the Google Chat narrative by default, but may stay in the technical GitHub release notes.
- Local branch, local worktree cleanliness, and local `HEAD` must not affect release selection.

## Google Chat Rules

- Store the webhook as the repository secret `GOOGLE_CHAT_WEBHOOK_URL`.
- Do not pass local webhook URLs to scripts or logs.
- Send only a complete Google Chat JSON payload through `.github/workflows/send-release-google-chat.yml`.
- Do not include screenshots, PR images, `cardsV2`, or `@all`.
- Keep the message in German, concise, and useful for founders/operators.

## Validation

Run after release tooling changes:

```bash
pnpm test
pnpm run lint
pnpm run build
pnpm run verify:google-chat
pnpm run verify:vercel-ready
```
