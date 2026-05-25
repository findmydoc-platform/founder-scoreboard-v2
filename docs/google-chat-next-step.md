# Google Chat Integration - Next Step

Stand: 2026-05-25

## Ziel

Google Chat soll für operative Benachrichtigungen der Founder-Plattform genutzt werden. Die App ist jetzt als Outbox vorbereitet: Events werden in Supabase gesammelt und können über eine Server-Route an Google Chat gesendet werden, sobald die Workspace-Konfiguration steht.

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

- `notification_events`: fachliches Ereignis, z.B. `task.review_requested`.
- `notification_deliveries`: Zustellversuche, Kanal, Status, Fehler, Retry.
- `notification_preferences`: steuerbar pro Person/Kanal.
- `profiles.google_chat_user_id`, `profiles.google_chat_dm_space`: vorbereitet für spätere private DM-Zustellung.

## Google Chat Stufen

1. MVP: ein Founder-Scoreboard-Space via Google Chat Webhook (`GOOGLE_CHAT_WEBHOOK_URL`).
2. Danach: echte private Nachrichten über Google Chat App/Bot und Chat API.

Wichtig: Ein Incoming Webhook kann nicht sauber als private 1:1-DM an einzelne Personen senden. Für private Nachrichten braucht es eine Google-Chat-App/Bot-Konfiguration in Google Cloud und eine Zuordnung der Profile zu Google-Chat-Usern bzw. DM-Spaces.

## Aktueller Umsetzungsschritt

Erledigt:

1. Task-Kommentare und Blocker-Meldungen erzeugen Events.
2. Review-Deadline ist am Sprint modelliert.
3. Notification-Outbox Tabellen/API sind ergänzt.
4. Events beim Review-Anfragen, Review-Abschluss, Task-Kommentar, Blocker, Task-Vorschlag und Meeting-Rückmeldung werden erzeugt.
5. `POST /api/notifications/deliver` verarbeitet Pending-Events und sendet über Google Chat Webhook, wenn `GOOGLE_CHAT_WEBHOOK_URL` gesetzt ist.
6. Einstellungen zeigen die Google Chat Outbox und erlauben manuelles Senden.

Noch offen:

1. Google Workspace/Google Cloud konfigurieren.
2. `GOOGLE_CHAT_WEBHOOK_URL` lokal und später in Deployment-ENV setzen.
3. Private DM-Zustellung mit Google Chat App/Bot später ergänzen.

## Nicht vergessen

Ein Incoming Webhook sendet nur in den konfigurierten Space. Für private 1:1-DMs brauchen wir danach eine Google-Chat-App/Bot-Konfiguration.
