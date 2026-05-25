---
name: fmd-german-utf8
description: Use whenever editing German UI copy, Markdown docs, tests with German strings, labels, buttons, status messages, empty states, calendar/dropdown text, or generated content in Founder Scoreboard. Preserve real UTF-8 umlauts and verify no visible German text uses ae/oe/ue/ss fallbacks by accident.
---

# FMD German UTF-8

## Rule

Visible German text must use real UTF-8 characters:

- ä, ö, ü
- Ä, Ö, Ü
- ß

Do not replace them with `ae`, `oe`, `ue`, `Ae`, `Oe`, `Ue`, or `ss` unless the target is a technical identifier, slug, URL, field name, or explicitly ASCII-only file.

## Workflow

1. Before editing, check the surrounding file style and keep UTF-8.
2. When adding German copy, write natural German spelling with real umlauts.
3. Before finishing, search edited visible text for suspicious fallbacks such as `fuer`, `zurueck`, `waehlen`, `loeschen`, `naechst`, `koennen`, `moech`, `groess`, `schliess`, `Ueber`, `Aender`, and `Oeff`.
4. Do not change technical identifiers, URLs, CSS classes, API fields, database columns, migration names, or environment variables only because they contain ASCII fallbacks.
5. Run `npm test` after changing user-facing German copy so the UI policy guard can catch regressions.

## Common replacements

- `für`, not `fuer`
- `zurück`, not `zurueck`
- `wählen`, not `waehlen`
- `löschen`, not `loeschen`
- `nächster`, not `naechster`
- `können`, not `koennen`
- `schließen`, not `schliessen`
