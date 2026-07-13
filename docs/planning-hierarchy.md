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
3. Exakte Treffer können mit `pnpm run plan:github-linking -- --apply` in Supabase verknüpft werden.
4. Danach aktualisiert der normale Task-Sync das bestehende Issue per `PATCH`, statt ein neues Issue zu öffnen.
5. Unsichere oder mehrdeutige Treffer bleiben unberührt und werden manuell entschieden.

Damit bleiben Kommentare und Historie in GitHub erhalten, während die aktuelle Aufgabenbeschreibung aus der App kommt.

## GitHub-Sync

Die App bleibt führend. GitHub im Repo `findmydoc-platform/management` ist ein One-way-Backup und eine nachvollziehbare Dokumentation.

Jede gültige, einem Teamprofil zugeordnete Session darf den Issue-Sync auslösen, unabhängig von Rolle, Owner oder Assignee. Der Issue-Sync verwendet ausschließlich das GitHub-App-Installationstoken. Viewer bleiben für Task-Änderungen und neue Kommentare read-only.

Gespiegelte GitHub-Issues enthalten im Beschreibungstext nur den Bearbeitungskern:

- `Problem Statement`
- `Intended Outcome`
- `Scope & Constraints`
- `Acceptance Criteria`
- `Evidence Required`
- `Definition of Done`
- einen kurzen FounderOps-Rücklink mit One-way-Sync-Hinweis

Struktur- und Steuerungsdaten wie Epic / Milestone, Initiative, Sprint, RACI, Status, Priorität, Blocker, Beziehungen und Kommentare sollen nicht als Text-Snapshot in die Issue-Beschreibung. Sie bleiben in FounderOps führend und können über native GitHub-Mittel wie Assignees, Milestones, Project-Felder, Dependencies, Sub-Issues oder Kommentare gespiegelt werden.

`blocked_by` und `blocks` werden als native GitHub Issue Dependencies gespiegelt, wenn beide FounderOps-Aufgaben mit GitHub-Issues verknüpft sind. `relates_to` bleibt FounderOps-intern, weil GitHub dafür keine echte native Beziehung anbietet und Body- oder Kommentar-Links keinen Relationships-Ersatz bilden.

Lokale Kommentare werden über eine getrennte Zustellungs-Outbox mit dem persönlichen GitHub-Token ihres ursprünglichen Autors veröffentlicht. Fehlt diese Autorenverbindung, wartet nur der Kommentar; der Issue-Sync bleibt erfolgreich. Dauerhafte Kommentar-Marker und ein exakter Altbestandsabgleich verhindern doppelte GitHub-Kommentare.

Alte Workflows oder Templates im Management-Repo dürfen nicht als Quelle der Wahrheit verwendet werden. Sie können später ersetzt oder gelöscht werden, aber nur nach expliziter Freigabe.

## Approval lifecycle

Approval is separate from work status. Initiatives and Deliverables use `draft`, `proposed`, `approved`, or `rejected`. Sub-Issues have no approval record and derive their effective state from the parent Deliverable.

- The CEO or a Deputy approves or rejects Initiatives.
- The CEO, a Deputy, or the current Initiative Accountable approves or rejects Deliverables.
- Approving an Initiative does not approve existing or future Deliverables.
- A new Deliverable always starts as proposed unless the CEO explicitly uses the combined create-and-approve action.
- Sprint carry-overs create a new proposed Deliverable without a Sprint assignment. They require the normal approval decision before later Sprint planning.
- Approved Deliverables may remain in the backlog without a Sprint. They become score-relevant only after Sprint assignment.
- Material brief or Initiative changes create a new approval revision and reset an approved Deliverable to proposed.
- Sprint, work status, Evidence, comments, and GitHub sync metadata do not reset approval.
- Proposed or rejected Deliverables cannot enter Sprint planning, Review, scoring, or GitHub projection.
- A Sub-Issue may be moved to another Deliverable by the CEO, a Deputy, or its current owner or assignee. It immediately inherits the target Initiative, Milestone, and effective approval state; the next explicit GitHub sync replaces the native parent relationship.

## GitHub item repositories

Deliverables are projected exclusively to `findmydoc-platform/management`. Sub-Issues may use a repository from the server-side registry. FounderOps verifies repository and issue number before updates. A synced Sub-Issue is connected to its FounderOps parent as a native GitHub Sub-Issue, including cross-repository relationships.
