# Founder Scoreboard v2 - Abnahmecheckliste

Stand: 2026-05-25

## Vorab

Diese Checks sollen bewusst mit echter CEO-Session im Browser laufen. Automatische Read-only-Prüfungen laufen über:

```bash
npm run verify:supabase
npm run verify:auth
npm run verify:operational
npm test
npm run lint
npm run build
```

## Login und Basiszustand

1. App unter `http://localhost:3000` öffnen.
2. Mit GitHub anmelden.
3. Unten links muss der Teamzugriff die angemeldete Session zeigen.
4. `/api/health` muss `status: "ready"` melden.

Erwartung:
- Datenquelle ist Supabase.
- 5 Profile sind vorhanden.
- Volkan/MehmetVolkan ist CEO.
- Navigation zeigt Planung, Sprint & Score, Decision Log, Meeting Finder, Team, Einstellungen.

## Planung und Task-Erstellung

1. In `Planung` auf `Neu` klicken.
2. Als CEO ein Deliverable erstellen.
3. Prüfen, dass es im Board bei `Offen` erscheint.
4. Task öffnen und Status per Select ändern.
5. Task per Drag and Drop in eine andere Spalte verschieben.

Erwartung:
- Statuswechsel persistiert nach Reload.
- Deliverable ist score-relevant.
- Sub-Issues erscheinen nur im Detailpanel, nicht als eigene Board-Karte.

## Kommentare, Blocker und Review

1. Task öffnen.
2. Kommentar erfassen.
3. Blocker melden.
4. Review anfragen.
5. Als CEO über die Review-Checkliste akzeptieren, teilweise akzeptieren oder Nacharbeit setzen.

Erwartung:
- Kommentare und Blocker bleiben nach Reload sichtbar.
- Blocker setzt den Status auf `Blockiert`.
- Review-Anfrage setzt Status `Review`.
- Nacharbeit setzt Status `Nacharbeit`.
- Punkte werden erst nach Review final.

## Sprint & Score

1. `Sprint & Score` öffnen.
2. Sprint-Daten prüfen: Start, Ende, Review bis, Status.
3. Commitment pro Founder setzen: Lite, Standard, Heavy oder Away.
4. Wochenstunden erfassen.
5. Meeting-Anwesenheit und schriftliches Update testen.

Erwartung:
- Scoreboard ist tabellarisch.
- Commitments bleiben nach Reload erhalten.
- Meeting-Punkte sind separat von Task-Punkten sichtbar.

## Sprintabschluss und Carry-over

Nur ausführen, wenn Testdaten oder ein bewusst abschließbarer Sprint genutzt wird.

1. Offene Aufgabe mit Blocker anlegen oder bestehende Testaufgabe nutzen.
2. Sprint abschließen.
3. Neue Carry-over-Aufgabe im nächsten Sprint prüfen.

Erwartung:
- Ursprüngliche Aufgabe bekommt `score_final=true` und 0 offene Punkte.
- Kommunizierter Blocker wird als `accepted_carryover` markiert.
- Carry-over-Aufgabe zeigt Ursprung und Grund im Detailpanel.
- Notification-Event `sprint.task_carried_over` entsteht.

## Decision Log

1. Decision als CEO erstellen.
2. Decision editieren.
3. Audit Trail ausklappen.
4. Einwand erfassen.
5. Bestätigung testen.

Erwartung:
- Edit ist CEO-only.
- Audit zeigt Vorher/Nachher.
- Einwände sind sichtbar.
- Nach allen erforderlichen Bestätigungen wird gelockt.

## GitHub Sync

Voraussetzung:
- `GITHUB_SYNC_TOKEN` ist gesetzt.
- Token hat Zugriff auf `findmydoc-platform/management`.

Check:
1. Task öffnen.
2. `Jetzt spiegeln` klicken.
3. Link zum GitHub Issue prüfen.

Erwartung:
- Issue wird im Management-Repo erstellt oder aktualisiert.
- Body enthält Epic / Meilenstein, Group Commitment, Sprint, Review, Score, Blocker und Kommentare.
- GitHub bleibt one-way Backup, nicht führendes System.

## Google Chat

Voraussetzung:
- `GOOGLE_CHAT_WEBHOOK_URL` ist gesetzt.

Check:
1. Event erzeugen, z. B. Kommentar oder Review-Anfrage.
2. Einstellungen öffnen.
3. In `Google Chat Outbox` `Pending senden` klicken.

Erwartung:
- Delivery wird als `sent` oder mit konkretem Fehler gespeichert.
- Ohne Webhook bleibt die Outbox sichtbar, aber Versand scheitert kontrolliert.

## Offene V1-Grenzen

- Private 1:1-Google-Chat-DMs brauchen später eine Google Chat App/Bot-Konfiguration.
- GitHub-Sync ist V1 one-way App zu GitHub.
- Drag/Resize im Gantt ist noch nicht Teil von V1.
- Andere Founder-Logins müssen noch real getestet werden, sobald sie sich einmal angemeldet haben.
