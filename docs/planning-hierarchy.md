# Founder Scoreboard v2 Planungshierarchie

## Verbindliche Struktur

```text
Epic / Meilenstein
  -> Initiative
      -> Deliverable
          -> Sub-Issue
```

Der Sprint ist ein Zeitcontainer und keine fachliche Parent-Ebene. Ein Deliverable gehört fachlich zu einer Initiative und zeitlich zu einem Sprint.

## Begriffe

### Epic / Meilenstein
Strategisches Ziel über mehrere Sprints. Beispiele: Investor Ready, Messe Launch, Legal Go-Live. Ein Epic bündelt Initiativen und ist nicht direkt scoring-relevant.

### Initiative
Outcome-Brief innerhalb eines Epics. Eine Initiative erklärt, warum mehrere Deliverables zusammengehören, wer sie ownern soll und woran das Ergebnis erkannt wird. Sie ist nicht direkt scoring-relevant.

Mini-RACI liegt auf der Initiative:

- `Accountable`: genau eine Person mit Entscheidungs- und Ergebnisverantwortung.
- `Responsible`: eine oder mehrere Personen, die Umsetzung oder Führung übernehmen.
- `Consulted`: Personen, die aktiv einbezogen werden.
- `Informed`: Personen, die informiert bleiben.

Responsible, Consulted und Informed werden als Profil-Listen geführt. Sub-Issues bekommen kein eigenes RACI.

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
- `Initiative`
- `RACI: Accountable / Responsible / Consulted / Informed`
- `Sprint`
- `Typ`
- `Problem Statement`
- `Intended Outcome`
- `Acceptance Criteria`
- `Evidence Required`
- `Definition of Done`
- `Source of Truth`

Alte Workflows oder Templates im Management-Repo dürfen nicht als Quelle der Wahrheit verwendet werden. Sie können später ersetzt oder gelöscht werden, aber nur nach expliziter Freigabe.
