# Founder Deliverable Template v2

Die alten GitHub-Templates bleiben nur Referenz. Neue Sprint-Deliverables verwenden diese Struktur und hängen in der neuen Hierarchie:

```text
Epic / Meilenstein
  -> Initiative
      -> Deliverable
          -> Sub-Issue
```

Der Sprint ist kein Parent in dieser Hierarchie, sondern der Zeitcontainer für Deliverables.

## Epic / Meilenstein
Strategisches Ziel über mehrere Sprints, z. B. Investor Ready, Messe Launch oder Legal Go-Live. Nicht direkt scoring-relevant.

## Initiative
Outcome-Brief innerhalb eines Epics. Bündelt mehrere Deliverables, benennt Owner, Ziel und Erfolgskriterien, ist aber selbst nicht direkt scoring-relevant.

Die Initiative trägt den Mini-RACI-Kontext: genau ein Accountable-Profil sowie Profil-Listen für Responsible, Consulted und Informed. Deliverables berücksichtigen diesen Kontext, bleiben aber die score-relevante Arbeitsebene.

## Deliverable
Konkrete Aufgabe mit Owner, Sprint, Priorität, Zeitraum und Review. Nur Deliverables sind scoring-relevant.

## Sub-Issue
Persönliche Arbeitsunterteilung unter einem Deliverable. Nicht scoring-relevant.

## Problem Statement
Beschreibt den aktuellen Zustand, das konkrete Problem oder den Pain Point und warum es jetzt relevant ist. Keine Lösung, Umsetzungsschritte oder technische Vorgaben in das Problem Statement schreiben.

## Intended Outcome
Welcher fertige Zustand soll erreicht sein?

## Scope & Constraints
Was gehört zur Aufgabe, was nicht, und welche Rahmenbedingungen gelten?

Harte Vorgaben wie Recht, Compliance, Datenschutz, Security, externe API-Verträge oder zwingende Integrationsgrenzen gehören hierhin, nicht in das Problem Statement.

## Acceptance Criteria
- Messbar und objektiv prüfbar.
- Konkret für dieses Issue.
- Nur Punkte, die der Owner beeinflussen kann.
- Im abgeschlossenen Zustand formuliert.
- Bei bereits freigegebenen, reviewten oder GitHub-gesyncten Stories nicht stillschweigend inhaltlich ändern; Änderungen als explizite Revision, Kommentar oder Follow-up behandeln.

## Evidence Required
Welcher Nachweis muss vorliegen, z. B. Notion-Link, GitHub-Kommentar, Screenshot, CSV, PR oder CRM-View?

## Definition of Done
Zentraler Qualitätsstandard oder gespeicherter DoD-Snapshot. Nicht mit Acceptance Criteria vermischen.

Wenn mehrere Bedingungen gelten, DoD als mehrere kurze Checklist-Punkte formulieren. Nicht mehrere Abschlussbedingungen in einen einzigen Absatz packen.

Nicht in die DoD gehören Meta-Punkte zur Aufgabenerstellung wie `Template v2 ist vollständig ausgefüllt`, `Aufgabe ist im Sprint`, `Owner ist gesetzt` oder ähnliche Formular-/Zuordnungschecks. Diese Punkte sind Qualitätsregeln beim Anlegen der Aufgabe, aber kein fachlicher Abschlussstandard für den Owner.

## Follow-up / Sub-Issues
Optional. Dient der persönlichen Arbeitsstruktur und ist nicht score-relevant.

## Approval-sensitive changes

Changing the Deliverable type, Initiative, title, Problem Statement, Intended Outcome, Scope & Constraints, Acceptance Criteria, or Definition of Done creates a new approval revision. An approved Deliverable returns to `proposed`. Evidence, comments, work status, Sprint operations, and GitHub sync metadata remain operational changes and do not reset approval.
