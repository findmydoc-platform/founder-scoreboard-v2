# Google Chat Integration - Next Step

Stand: 2026-05-27

Der kontrollierte Aktivierungsplan steht in `docs/google-chat-rollout.md`.

## Ziel

Google Chat soll nicht zum Einzelspam werden. Die App sammelt operative Ereignisse in Supabase, zeigt sie jedem Nutzer als In-App-Notification und sendet nur wichtige Sammelmeldungen in den bestehenden Founder-Scoreboard-Chat.

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
- `profiles.google_chat_user_id`, `profiles.google_chat_dm_space`: vorbereitet für spätere private DM-Zustellung.

## Google Chat Stufen

1. MVP: ein Founder-Scoreboard-Space via Google Chat Webhook (`GOOGLE_CHAT_WEBHOOK_URL`) mit priorisiertem Digest statt Einzelspam.
2. Danach: echte private Nachrichten über Google Chat App/Bot und Chat API.

Wichtig: Ein Incoming Webhook sendet nur in den konfigurierten Space. Für echte private 1:1-DMs braucht es eine Google-Chat-App/Bot-Konfiguration in Google Cloud und eine Zuordnung der Profile zu Google-Chat-Usern bzw. DM-Spaces.

## FounderOps Entscheidung

Die Chat-App/Bot-Anzeige soll `FounderOps` heißen. Der geplante Google-Chat-App-Endpoint nach Vercel-Deployment und Domain-Cutover ist:

```text
https://founderops.findmydoc.eu/api/google-chat/events
```

Vorherige Namen wie `Founder Scoreboard Bot` oder `Founders CoreBot` gelten als Altbezeichnungen und sollen bei neuen Konfigurations- oder Codeänderungen nicht weiterverwendet werden.

## Aktueller Umsetzungsschritt

Erledigt:

1. Task-Kommentare und Blocker-Meldungen erzeugen Events.
2. Review-Deadline ist am Sprint modelliert.
3. Notification-Outbox Tabellen/API sind ergänzt.
4. Events beim Review-Anfragen, Review-Abschluss, Task-Kommentar, Blocker, Task-Vorschlag und Meeting-Rückmeldung werden erzeugt.
5. Die Kopfzeile zeigt eine In-App-Notification-Inbox für persönliche Hinweise.
6. `POST /api/notifications/deliver` verarbeitet Pending-Events, filtert auf wichtige Chat-Typen und sendet einen Google-Chat-Digest, wenn `GOOGLE_CHAT_WEBHOOK_URL` gesetzt ist und `GOOGLE_CHAT_DELIVERY_ENABLED=true` gilt.
7. Einstellungen zeigen den Google Chat Digest, den Zustellstatus und die persönlichen Event-Präferenzen.
8. `/api/google-chat/events` ist als sichere Vorschau-Route vorbereitet und antwortet auf Google-Chat-Events, ohne die Zustellung zu aktivieren.

Noch offen:

1. `GOOGLE_CHAT_WEBHOOK_URL` lokal und später in Deployment-ENV setzen.
2. `GOOGLE_CHAT_DELIVERY_ENABLED=false` als sicheren Standard beibehalten.
3. Vor echter Aktivierung `npm run verify:google-chat` ausführen.
4. Optional: private DM-Zustellung mit Google Chat App/Bot später ergänzen.

## Offene Punkte für persönliche DMs

1. Von jedem Teammitglied die `FounderOps`-Direktchat-URL einsammeln und als `spaces/...` in `profiles.google_chat_dm_space` speichern.
2. `founderops.findmydoc.eu` auf Vercel schalten und `/api/google-chat/events` im Deployment testen.
3. Private DM-Zustellung über Google Chat API an `spaces/{dmSpace}/messages` ergänzen; der bestehende Webhook-Digest sendet nicht automatisch in persönliche DMs.

## Nicht vergessen

In-App bleibt der Hauptkanal für individuelle Arbeit. Google Chat ist nur für wichtige Sammelmeldungen gedacht.
