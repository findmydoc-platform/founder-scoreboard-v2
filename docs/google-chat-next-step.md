# Google Chat Integration - Next Step

Stand: 2026-05-29

Der kontrollierte Aktivierungsplan steht in `docs/google-chat-rollout.md`.

## Ziel

Google Chat soll nicht zum Einzelspam werden. Die App sammelt operative Ereignisse in Supabase, zeigt sie jedem Nutzer als In-App-Notification und sendet nur wichtige Sammelmeldungen oder persönliche FounderOps-DMs.

## Gewünschte Benachrichtigungen

- Decision Log: Founder/CEO müssen bestätigen.
- Aufgaben: neue Zuweisung, Statusänderung, Kommentar/Nachfrage, Blocker.
- Review: Founder reicht Aufgabe zur Review ein, CEO wird informiert.
- Review-Ergebnis: Founder wird über Punkte, Teilannahme oder Nacharbeit informiert.
- Sprint-Ende: Founder werden rechtzeitig an offene Deliverables erinnert.
- Review-Deadline: Founder werden vor Sprintende erinnert, Review rechtzeitig einzureichen oder Blocker zu melden.
- Meeting/Biweekly: Teilnahme, Abmeldung, schriftliches Update und Punkte lösen ebenfalls Benachrichtigungen aus.

## Technische Entscheidung

Nicht direkt beim Speichern an Google Chat senden. Stattdessen nutzt die App eine Notification-Outbox:

- `notification_events`: fachliches Ereignis und In-App-Hinweis, z.B. `task.review_requested`.
- `notification_deliveries`: Zustellversuche, Kanal, Status, Fehler, Retry.
- `notification_preferences`: steuerbar pro Person und Event-Typ.
- `profiles.google_chat_user_id`, `profiles.google_chat_dm_space`: Zuordnung für persönliche DM-Zustellung.

## Google Chat Stufen

1. MVP: sicherer Outbox-Betrieb mit deaktiviertem Versand.
2. Optionaler Fallback: ein Space-Digest via `GOOGLE_CHAT_WEBHOOK_URL`.
3. Zielzustand: persönliche FounderOps-DMs über Google Chat API an `spaces/...`.

Wichtig: Ein Incoming Webhook sendet nur in den konfigurierten Space. Für echte private DMs braucht es die FounderOps Chat-App, Chat API, Service Account und `profiles.google_chat_dm_space`.

## FounderOps Entscheidung

Die Chat-App/Bot-Anzeige heißt `FounderOps`. Der geplante Google-Chat-App-Endpoint nach Vercel-Deployment und Domain-Cutover ist:

```text
https://founderops.findmydoc.eu/api/google-chat/events
```

Vorherige Namen wie `Founder Scoreboard Bot` oder `Founders CoreBot` gelten als Altbezeichnungen.

## Aktueller Umsetzungsschritt

Erledigt:

1. Task-Kommentare und Blocker-Meldungen erzeugen Events.
2. Review-Deadline ist am Sprint modelliert.
3. Notification-Outbox Tabellen/API sind ergänzt.
4. Events beim Review-Anfragen, Review-Abschluss, Task-Kommentar, Blocker, Task-Vorschlag und Meeting-Rückmeldung werden erzeugt.
5. Die Kopfzeile zeigt eine In-App-Notification-Inbox für persönliche Hinweise.
6. Einstellungen zeigen Google Chat, Zustellstatus, Fehler und persönliche Event-Präferenzen.
7. `/api/google-chat/events` ist als sichere Vorschau-Route vorbereitet.
8. `/api/notifications/deliver` kann bei aktivierter Chat API persönliche FounderOps-DMs an `profiles.google_chat_dm_space` senden.
9. Ohne DM-Space wird sauber in `notification_deliveries` protokolliert oder bei gesetztem Webhook in den Space-Digest zurückgefallen.

Noch offen:

1. `founderops.findmydoc.eu` auf Vercel schalten und `/api/google-chat/events` im Deployment testen.
2. Google Chat API in Google Cloud aktivieren.
3. Service-Account-Werte als Deployment-ENV setzen.
4. Von jedem Teammitglied den FounderOps-DM-Space einsammeln und in den Profilen speichern.
5. Erst danach `GOOGLE_CHAT_DELIVERY_ENABLED=true` aktivieren.

## Nicht vergessen

In-App bleibt der Hauptkanal für individuelle Arbeit. Google Chat ist nur für wichtige Hinweise gedacht.
