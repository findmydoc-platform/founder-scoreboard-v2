# Founder Scoreboard v2 Planungshierarchie

## Verbindliche Struktur

```text
Epic / Meilenstein
  -> Group Commitment
      -> Deliverable
          -> Sub-Issue
```

Der Sprint ist ein Zeitcontainer und keine fachliche Parent-Ebene. Ein Deliverable gehört fachlich zu einem Group Commitment und zeitlich zu einem Sprint.

## Begriffe

### Epic / Meilenstein
Strategisches Ziel über mehrere Sprints. Beispiele: Investor Ready, Messe Launch, Legal Go-Live. Ein Epic bündelt Group Commitments und ist nicht direkt scoring-relevant.

### Group Commitment
Themenblock innerhalb eines Epics. Ein Group Commitment erklärt, warum mehrere Deliverables zusammengehören. Es ist nicht direkt scoring-relevant.

### Deliverable
Konkrete Aufgabe mit Owner, Sprint, Priorität, Zeitraum, Review und Evidence. Nur Deliverables werden bepunktet.

### Sub-Issue
Persönliche Arbeitsunterteilung eines Deliverables. Founder dürfen damit eigene Schritte strukturieren. Sub-Issues sind nicht scoring-relevant.

## Bestehende GitHub-Issues

Alte Deliverable-Issues im `findmydoc-platform/management`-Repo werden nicht gelöscht und nicht dupliziert. Sie sind historische Hüllen und werden beim Sync auf die neue v2-Struktur aktualisiert.

Vorgehen:

1. Supabase bleibt führend.
2. Bestehende GitHub-Issues werden über `scripts/plan-github-issue-linking.mjs` per normalisiertem Titel vorgeschlagen.
3. Exakte Treffer können mit `npm run plan:github-linking -- --apply` in Supabase verknüpft werden.
4. Danach aktualisiert der normale Task-Sync das bestehende Issue per `PATCH`, statt ein neues Issue zu öffnen.
5. Unsichere oder mehrdeutige Treffer bleiben unberührt und werden manuell entschieden.

Damit bleiben Kommentare und Historie in GitHub erhalten, während die aktuelle Aufgabenbeschreibung aus der App kommt.

## GitHub-Sync

Die App bleibt führend. GitHub im Repo `findmydoc-platform/management` ist ein One-way-Backup und eine nachvollziehbare Dokumentation.

Gespiegelte GitHub-Issues müssen die Struktur explizit enthalten:

- `Epic / Milestone`
- `Group Commitment`
- `Sprint`
- `Typ`
- `Problem Statement`
- `Intended Outcome`
- `Acceptance Criteria`
- `Evidence Required`
- `Definition of Done`
- `Source of Truth`

Alte Workflows oder Templates im Management-Repo dürfen nicht als Quelle der Wahrheit verwendet werden. Sie können später ersetzt oder gelöscht werden, aber nur nach expliziter Freigabe.
