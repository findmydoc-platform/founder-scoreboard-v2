# FMD Story Writing Examples

## Problem Statement

Good:

> Die gemeinsamen Teamkosten liegen aktuell in Splitwise, weil noch keine Firma besteht. Der Stand ist nicht sauber gepflegt, wodurch unklar ist, ob alle Kosten korrekt erfasst sind und wer wem welchen Betrag schuldet. Das blockiert eine faire und nachvollziehbare Kostenklärung vor der nächsten Finanzplanung.

Why it works: It explains current state, pain point, and motivation without prescribing the implementation.

Bad:

> Baue eine Tabelle, prüfe alle Splitwise-Einträge und schreibe die Beträge in Notion.

Why it fails: It describes execution steps instead of the problem.

## Hard Constraints

Use `Scope & Constraints` for binding constraints:

- Medizinische Claims dürfen nicht ungeprüft auf findmydoc veröffentlicht werden.
- Keine personenbezogenen Patientendaten in GitHub, Notion oder Screenshots ablegen.
- GitHub bleibt Backup; Supabase/App bleibt führendes System.

Use `Acceptance Criteria` for verifiable finished states:

- Alle verwendeten Claims sind als interne Arbeitsannahme markiert oder mit Quelle belegt.
- Der Evidence-Link enthält keine personenbezogenen Patientendaten.
- Das GitHub-Issue ist mit dem App-Deliverable verknüpft.

## Acceptance Criteria vs. Definition of Done

Acceptance Criteria:

- Die relevanten Splitwise-Einträge sind geprüft.
- Offene Ausgleichszahlungen sind pro Person nachvollziehbar dokumentiert.
- Unklare Beträge sind mit Owner und nächstem Klärungsschritt markiert.

Definition of Done:

- Evidence ist verlinkt.
- Offene Follow-ups sind als Sub-Issue oder Kommentar dokumentiert.
- Das Ergebnis ist für den nächsten Arbeitsschritt ohne zusätzliche Erklärung nutzbar.

## Protected Existing Story

If a GitHub-synced story has unclear Acceptance Criteria, do not silently rewrite them. Add a comment like:

> Vorschlag für eine künftige Revision: AC 2 könnte objektiver formuliert werden, weil der aktuelle Wortlaut vom externen Feedback eines Investors abhängt.

Only change the story body when the user explicitly approves the content change.
