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

Operative Event Messages bleiben in der Applikation. Eine Google-Chat-Pipeline darf nur für Release-Details oder Deployment-Zusammenfassungen verwendet werden.

## Google Chat Stufen

1. In-App: operative Event Messages bleiben im Board und in der Outbox.
2. Release-Kanal: GitHub Actions darf bei Bedarf Release-Details oder Deployment-Zusammenfassungen an Google Chat senden.
3. Danach: echte private Nachrichten über Google Chat App/Bot und Chat API.

Wichtig: Ein Incoming Webhook sendet nur in den konfigurierten Space. Für echte private 1:1-DMs braucht es eine Google-Chat-App/Bot-Konfiguration in Google Cloud und eine Zuordnung der Profile zu Google-Chat-Usern bzw. DM-Spaces. Die Release-Pipeline ist davon getrennt.

## FounderOps Entscheidung

Die Chat-App/Bot-Anzeige soll `FounderOps` heißen. Der geplante Google-Chat-App-Endpoint nach GitHub-Actions-Deployment und Domain-Cutover ist:

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
6. Einstellungen zeigen Google Chat, Zustellstatus, Fehler und persönliche Event-Präferenzen.
7. `/api/google-chat/events` ist als sichere Vorschau-Route vorbereitet.
8. `/api/notifications/deliver` kann bei aktivierter Chat API persönliche FounderOps-DMs an `profiles.google_chat_dm_space` senden.
9. Ohne DM-Space wird sauber in `notification_deliveries` protokolliert oder bei gesetztem Webhook in den Space-Digest zurückgefallen.

Noch offen:

1. `GOOGLE_CHAT_WEBHOOK_URL` lokal und später in Deployment-ENV setzen.
2. `GOOGLE_CHAT_DELIVERY_ENABLED=false` als sicheren Standard beibehalten.
3. Vor echter Aktivierung `npm run verify:google-chat` ausführen.
4. Optional: private DM-Zustellung mit Google Chat App/Bot später ergänzen.

## Offene Punkte für persönliche DMs

1. Von jedem Teammitglied die `FounderOps`-Direktchat-URL einsammeln und als `spaces/...` in `profiles.google_chat_dm_space` speichern.
2. `founderops.findmydoc.eu` auf die per GitHub Actions deployte App schalten und `/api/google-chat/events` im Deployment testen.
3. Private DM-Zustellung über Google Chat API an `spaces/{dmSpace}/messages` ergänzen; der bestehende Webhook-Digest sendet nicht automatisch in persönliche DMs.

## Nicht vergessen

In-App bleibt der Hauptkanal für individuelle Arbeit. Google Chat ist nur für wichtige Sammelmeldungen gedacht.
