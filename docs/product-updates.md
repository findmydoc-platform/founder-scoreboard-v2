# Product Update Gallery

FounderOps explains user-visible changes inside the product with a lightweight screenshot gallery. Unseen entries open once per profile and browser. The complete gallery remains available from the existing help menu under **Was ist neu**.

## Release rule

Every production deployment with a user-visible change must:

1. Add or extend an entry in `src/features/product-updates/model/product-updates.json`.
2. Add at least one current screenshot under `public/product-updates/<update-id>/`.
3. Explain the visible change and user benefit in short, non-technical German copy.
4. Add a dedicated, focused Driver.js tour and connect it through the update-level `featureTourId`.
5. Set `expiresAt` to 30 days after `releasedAt` by default. The verifier allows at most 60 days.
6. Run `pnpm run verify:product-updates`.

Purely operational changes do not create a gallery entry. They must not reuse an old update ID to reopen stale product news.

The production deployment passes the previous `main` revision to the verifier. If user-facing TSX or CSS changed, deployment fails unless both the registry and a screenshot under `public/product-updates/` changed. Manual local verification validates the complete registry without requiring a Git base revision.

## Entry contract

- Use a stable update ID in the form `YYYY-MM-DD-short-name`.
- Keep the newest update first.
- Set one unique `featureTourId` per update and add the same update ID as `productUpdateId` on its tour definition.
- Keep the tour as short as practical and guide the user to the changed interaction. The **Lass dich leiten** action must work from every slide.
- Use `expiresAt` to remove the update from automatic display and the help menu. Expiry is inclusive through the configured UTC day.
- Use one slide per coherent visible change. Several changes from the same deployment may share one update entry.
- Use screenshots of the relevant product UI, without private addresses, credentials, tokens, or sensitive founder data.
- Use a descriptive German `alt` text.
- Keep slide titles short and descriptions below 280 characters.
- Capture the desktop view at 1440 by 900 when practical. Add another slide only when the mobile behavior materially differs.

## Required Driver.js tour

The gallery and Driver.js serve different purposes. The gallery explains the change with screenshots. The required tour then shows where to click. Set `featureTourId` on the update and add a matching, dedicated tour in `src/features/product-tours/model/feature-tour-registry.ts`. Reusing one tour across several product updates is not allowed.

The update acknowledgement is intentionally local and profile-scoped. This keeps the feature lightweight, avoids schema coupling, and lets new update IDs queue independently if several releases have not yet been viewed. Expired entries are filtered before unseen-state selection and manual opening.
