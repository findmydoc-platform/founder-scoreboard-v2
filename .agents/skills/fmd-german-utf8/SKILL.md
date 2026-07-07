---
name: fmd-german-utf8
description: Use whenever editing German UI copy, Markdown docs, tests with German strings, labels, buttons, status messages, empty states, calendar/dropdown text, generated task content, GitHub issue bodies, Supabase seed/import data, or persisted task/story text in Founder Scoreboard. Preserve real UTF-8 umlauts and verify no visible German text was corrupted.
---

# FMD German UTF-8

## Rule

Visible German text must use real UTF-8 characters:

- ä, ö, ü
- Ä, Ö, Ü
- ß

Do not replace them with `ae`, `oe`, `ue`, `Ae`, `Oe`, `Ue`, or `ss` unless the target is a technical identifier, slug, URL, field name, migration name, or explicitly ASCII-only file.

Also reject corrupted text such as `f?r`, `L?sung`, `T?rkei`, `D?sseldorf`, mojibake sequences starting with `U+00C3`, replacement characters, or broken question marks inside German words.

## Workflow

1. Before editing, check the surrounding file style and keep UTF-8.
2. When adding German copy, write natural German spelling with real umlauts.
3. Avoid shell or PowerShell write paths for German prose unless the persisted result is verified afterwards. Prefer `apply_patch`, UTF-8 source files, or structured API payloads.
4. Before finishing, search edited visible text for suspicious fallbacks such as `fuer`, `zurueck`, `waehlen`, `loeschen`, `naechst`, `koennen`, `moech`, `groess`, `schliess`, `Ueber`, `Aender`, and `Oeff`.
5. Before finishing, search edited or generated content for corrupted UTF-8 markers: `?` inside German words, `Ã`, `Â`, or `�`.
6. If German task/story text was written into Supabase or synced to GitHub, verify the stored text, not only the local source. In `fmd-planning`, run `pnpm run verify:task-utf8` after task/story DB writes.
7. Do not change technical identifiers, URLs, CSS classes, API fields, database columns, migration names, or environment variables only because they contain ASCII fallbacks.
8. Run `pnpm test` after changing user-facing German copy so the UI policy guard can catch regressions.

## Common replacements

- `für`, not `fuer` or `f?r`
- `zurück`, not `zurueck` or `zur?ck`
- `wählen`, not `waehlen` or `w?hlen`
- `löschen`, not `loeschen` or `l?schen`
- `nächster`, not `naechster` or `n?chster`
- `können`, not `koennen` or `k?nnen`
- `schließen`, not `schliessen` or `schlie?en`
- `Lösung`, not `Loesung` or `L?sung`
- `Türkei`, not `Tuerkei` or `T?rkei`
