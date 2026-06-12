# Management-Repo v2 Aufräum- und Template-Plan

Ziel-Repo: `findmydoc-platform/management`

Die Founder-Scoreboard-v2-App bleibt führend. Das Management-Repo ist ein One-way-Backup und eine nachvollziehbare Dokumentation. Alte GitHub-Templates und Workflows dürfen nicht als Quelle der Wahrheit verwendet werden.

## Verbindliche neue Struktur

```text
Epic / Meilenstein
  -> Initiative
      -> Deliverable
          -> Sub-Issue
```

Sprint ist ein Zeitcontainer für Deliverables, keine Parent-Ebene.

## Aktueller Bestand und Empfehlung

| Datei | Aktueller Zweck | Bewertung | Empfehlung |
| --- | --- | --- | --- |
| `.github/ISSUE_TEMPLATE/1-management.yml` | Hochrangige Initiative für Management-Projekt | Von Sebastian erstellt, nicht direkt Teil des Founder-Scoreboards | Erstmal behalten |
| `.github/ISSUE_TEMPLATE/2-management-task.yml` | Aufgabe als Teil einer Initiative | Von Sebastian erstellt, nicht direkt Teil des Founder-Scoreboards | Erstmal behalten |
| `.github/ISSUE_TEMPLATE/initiative.yml` | Sprint-übergreifender Team-Meilenstein | Begrifflich nah an v2, aber verwechselt Meilenstein und Initiative | Durch v2-Initiative-Template ersetzen |
| `.github/ISSUE_TEMPLATE/deliverable.yml` | Altes Deliverable/Subtask-Issue | Vermischt Deliverable und Subtask, hängt an altem Auto-Triage-Workflow | Durch v2-Deliverable-Template ersetzen |
| `.github/ISSUE_TEMPLATE/commitment.yml` | Persönliches Sprint-Commitment als GitHub-Issue | Gehört jetzt in Supabase `sprint_commitments`, nicht nach GitHub | Deaktivieren oder löschen nach Freigabe |
| `.github/ISSUE_TEMPLATE/scoreboard_sprint.yml` | Sprint-Meta-Issue für Updates, Attendance, Blocker | Gehört jetzt in Supabase Sprints, Meetings, Blocker und Notifications | Deaktivieren oder löschen nach Freigabe |
| `.github/ISSUE_TEMPLATE/config.yml` | GitHub-Issue-Template-Konfiguration | Kann bleiben, muss aber auf v2-Templates zeigen | Anpassen nach Freigabe |
| `.github/workflows/auto-triage.yml` | Labels, Project-Felder, Sprint-Vererbung aus alten Issue-Bodies | Stört v2, weil die App führend ist und GitHub nur Backup ist | Deaktivieren oder löschen nach Freigabe |
| `.github/workflows/sprint-title-sync.yml` | Sprint-Issue-Titel anhand alter Project-Felder synchronisieren | Überflüssig, weil Sprints in Supabase liegen | Deaktivieren oder löschen nach Freigabe |

## Ersatz durch v2

Neue v2-Templates liegen als Vorschlag lokal unter:

- `docs/management-templates-v2/epic.yml`
- `docs/management-templates-v2/initiative.yml`
- `docs/management-templates-v2/deliverable.yml`
- `docs/management-templates-v2/sub-issue.yml`

Diese Templates sind für manuelle GitHub-Erstellung oder Fallback gedacht. Der reguläre Weg bleibt: App erstellt/ändert Aufgaben und spiegelt nach GitHub.

## Was ich ohne Freigabe nicht mache

- Keine Datei im Management-Repo löschen.
- Keine Workflow-Datei deaktivieren.
- Keine Template-Datei überschreiben.
- Keine historischen Issues ändern.

## Empfohlene Freigabe-Entscheidung

1. `1-management.yml` behalten.
2. `2-management-task.yml` behalten.
3. `initiative.yml` ersetzen durch v2.
4. `deliverable.yml` ersetzen durch v2.
5. `commitment.yml` löschen oder in `archive/` verschieben.
6. `scoreboard_sprint.yml` löschen oder in `archive/` verschieben.
7. `auto-triage.yml` deaktivieren/löschen.
8. `sprint-title-sync.yml` deaktivieren/löschen.

Meine Empfehlung: Erst archivieren statt endgültig löschen. Nach zwei Wochen stabiler Nutzung können wir die alten Dateien endgültig entfernen.
