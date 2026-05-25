# Google Chat Integration - Next Step

Stand: 2026-05-25

## Ziel

Google Chat soll nicht zum Einzelspam werden. Die App sammelt operative Ereignisse in Supabase, zeigt sie jedem Nutzer als In-App-Notification und sendet nur wichtige Sammelmeldungen in den bestehenden Founder-Scoreboard-Chat.

## Gewünschte Benachrichtigungen

- Decision Log: Founder/CEO müssen bestätigen.
- Aufgaben: neue Zuweisung, Statusänderung, Kommentar/Nachfrage, Blocker.
- Review: Founder reicht Aufgabe zur Review ein, CEO wird informiert.
- Review-Ergebnis: Founder wird über Punkte, Teilannahme oder Nacharbeit informiert.
- Sprint-Ende: Founder werden rechtzeitig an offene Deliverables erinnert.
- Review-Deadline: Founder werden vor Sprintende erinnert, Review rechtzeitig einzureichen oder Blocker zu melden.
- Meeting/Biweekly: Teilnahme, Abmeldung, schriftliches Update und Punkte sollen später ebenfalls Benachrichtigungen auslösen.

## Technische Entscheidung

Nicht direkt beim Speichern an Google Chat senden. Stattdessen zuerst eine Notification-Outbox bauen:

- `notification_events`: fachliches Ereignis und In-App-Hinweis, z.B. `task.review_requested`.
- `notification_deliveries`: Zustellversuche, Kanal, Status, Fehler, Retry.
- `notification_preferences`: steuerbar pro Person/Kanal.
- `profiles.google_chat_user_id`, `profiles.google_chat_dm_space`: vorbereitet für spätere private DM-Zustellung.

## Google Chat Stufen

1. MVP: ein Founder-Scoreboard-Space via Google Chat Webhook (`GOOGLE_CHAT_WEBHOOK_URL`) mit priorisiertem Digest statt Einzelspam.
2. Danach: echte private Nachrichten über Google Chat App/Bot und Chat API.

Wichtig: Ein Incoming Webhook sendet nur in den konfigurierten Space. Für echte private 1:1-DMs braucht es eine Google-Chat-App/Bot-Konfiguration in Google Cloud und eine Zuordnung der Profile zu Google-Chat-Usern bzw. DM-Spaces.

## Aktueller Umsetzungsschritt

Erledigt:

1. Task-Kommentare und Blocker-Meldungen erzeugen Events.
2. Review-Deadline ist am Sprint modelliert.
3. Notification-Outbox Tabellen/API sind ergänzt.
4. Events beim Review-Anfragen, Review-Abschluss, Task-Kommentar, Blocker, Task-Vorschlag und Meeting-Rückmeldung werden erzeugt.
5. Die Kopfzeile zeigt eine In-App-Notification-Inbox für persönliche Hinweise.
6. `POST /api/notifications/deliver` verarbeitet Pending-Events, filtert auf wichtige Chat-Typen und sendet einen Google-Chat-Digest, wenn `GOOGLE_CHAT_WEBHOOK_URL` gesetzt ist.
7. Einstellungen zeigen den Google Chat Digest und erlauben manuelles Senden.

Noch offen:

1. `GOOGLE_CHAT_WEBHOOK_URL` lokal und später in Deployment-ENV setzen.
2. Optional: private DM-Zustellung mit Google Chat App/Bot später ergänzen.

## Nicht vergessen

In-App bleibt der Hauptkanal für individuelle Arbeit. Google Chat ist nur für wichtige Sammelmeldungen gedacht.
